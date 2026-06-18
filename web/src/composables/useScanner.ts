import { ref, onUnmounted } from 'vue';

export type UploadResult = 'idle' | 'success' | 'failed' | 'rate_limited';

export interface ScannerState {
  status: 'idle' | 'starting' | 'scanning' | 'error';
  shareCode: string | null;
  uploadCount: number;
  lastUploadAt: number | null;
  lastUploadResult: UploadResult;
  lastUploadResultText: string | null;
  errorMessage: string | null;
  lastScannedText: string | null;
  expireAt: string | null;
  /** Offline queue count (for UI indicator) */
  offlineQueueSize: number;
  /** Expired-auto-rebuild notification */
  showRebuiltBanner: boolean;
}

const SCAN_INTERVAL_MS = 250;
const MIN_UPLOAD_GAP_MS = 500; // max 2/sec
const OFFLINE_QUEUE_MAX = 6;

export function useScanner() {
  const state = ref<ScannerState>({
    status: 'idle',
    shareCode: null,
    uploadCount: 0,
    lastUploadAt: null,
    lastUploadResult: 'idle',
    lastUploadResultText: null,
    errorMessage: null,
    lastScannedText: null,
    expireAt: null,
    offlineQueueSize: 0,
    showRebuiltBanner: false,
  });

  let videoEl: HTMLVideoElement | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let canvasCtx: CanvasRenderingContext2D | null = null;
  let stream: MediaStream | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;

  // ── Offline cache queue ──

  const offlineQueue: string[] = [];
  let lastSuccessfulText: string | null = null;

  function enqueueOffline(text: string): void {
    // Dedup against last queued item
    if (offlineQueue.length > 0 && offlineQueue[offlineQueue.length - 1] === text) {
      return;
    }
    // Drop oldest if full
    if (offlineQueue.length >= OFFLINE_QUEUE_MAX) {
      offlineQueue.shift();
    }
    offlineQueue.push(text);
    state.value.offlineQueueSize = offlineQueue.length;
  }

  async function drainOfflineQueue(): Promise<void> {
    while (offlineQueue.length > 0) {
      const text = offlineQueue[0];
      // Dedup: only send if different from last successful upload
      const dedupText = lastSuccessfulText;
      if (text === dedupText) {
        offlineQueue.shift();
        state.value.offlineQueueSize = offlineQueue.length;
        continue;
      }

      const result = await uploadText(text);
      if (result === 'error') {
        // Network still down, stop draining
        break;
      }
      // On success or expired, dequeue
      offlineQueue.shift();
      state.value.offlineQueueSize = offlineQueue.length;

      if (result === 'expired') {
        // Channel expired during drain, stop
        break;
      }
    }
  }

  // Reset offline queue (called when channel is rebuilt)
  function clearOfflineQueue(): void {
    offlineQueue.length = 0;
    state.value.offlineQueueSize = 0;
  }

  // ── Throttle queuing ──

  let pendingThrottleText: string | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleThrottledUpload(text: string): void {
    // Keep only latest text (merge intermediate)
    pendingThrottleText = text;

    if (throttleTimer) return; // already scheduled

    throttleTimer = setTimeout(async () => {
      throttleTimer = null;
      const t = pendingThrottleText;
      pendingThrottleText = null;
      if (!t) return;

      // Check dedup against last successful before sending
      if (t === lastSuccessfulText) return;

      const result = await uploadText(t);
      if (result === 'error') {
        enqueueOffline(t);
      }
    }, MIN_UPLOAD_GAP_MS);
  }

  function cancelThrottleTimer(): void {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    pendingThrottleText = null;
  }

  // ── Camera ──

  async function startCamera(videoElement: HTMLVideoElement): Promise<void> {
    videoEl = videoElement;

    if (!window.isSecureContext) {
      throw new Error('scanner.error.notSecure');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('scanner.error.noCameraApi');
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      videoEl.srcObject = stream;
      videoEl.setAttribute('playsinline', '');
      videoEl.play();

      canvasEl = document.createElement('canvas');
      canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });

      await new Promise<void>((resolve) => {
        const check = () => {
          if (videoEl!.videoWidth > 0 && videoEl!.videoHeight > 0) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });

      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      const scale = Math.min(1, 640 / Math.min(w, h));
      canvasEl!.width = Math.floor(w * scale);
      canvasEl!.height = Math.floor(h * scale);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        throw new Error('scanner.error.permissionDenied');
      }
      throw new Error(`scanner.error.cameraGeneric::${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stopCamera(): void {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    cancelThrottleTimer();
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
    canvasEl = null;
    canvasCtx = null;
  }

  // ── QR Decoding ──

  async function scanFrame(): Promise<string | null> {
    if (!videoEl || !canvasEl || !canvasCtx) return null;

    try {
      canvasCtx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      const imageData = canvasCtx.getImageData(0, 0, canvasEl.width, canvasEl.height);

      const { default: jsQR } = await import('jsqr');
      const code = jsQR(imageData.data, canvasEl.width, canvasEl.height, {
        inversionAttempts: 'dontInvert',
      });

      return code?.data ?? null;
    } catch {
      return null;
    }
  }

  // ── Channel management ──

  async function createChannel(): Promise<{ shareCode: string; expireAt: string }> {
    const resp = await fetch('/api/channel/create', { method: 'POST' });
    if (!resp.ok) throw new Error('scanner.error.createChannelFailed');
    const data = await resp.json();
    return { shareCode: data.data.shareCode, expireAt: data.data.expireAt };
  }

  // ── Upload ──

  function canUpload(): boolean {
    if (!state.value.lastUploadAt) return true;
    return Date.now() - state.value.lastUploadAt >= MIN_UPLOAD_GAP_MS;
  }

  async function uploadText(text: string): Promise<'ok' | 'expired' | 'error'> {
    const shareCode = state.value.shareCode;
    if (!shareCode) return 'error';

    try {
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareCode, text }),
      });

      if (resp.status === 404) {
        state.value.lastUploadResult = 'failed';
        state.value.lastUploadResultText = 'scanner.upload.result.channel_expired';
        return 'expired';
      }

      if (resp.status === 429) {
        state.value.lastUploadResult = 'rate_limited';
        state.value.lastUploadResultText = 'scanner.upload.result.rate_limited';
        return 'ok'; // Still "ok" for flow control — will be throttled
      }

      if (resp.ok) {
        state.value.uploadCount++;
        state.value.lastUploadAt = Date.now();
        state.value.lastUploadResult = 'success';
        state.value.lastUploadResultText = null;
        state.value.lastScannedText = text;
        lastSuccessfulText = text;
        return 'ok';
      }

      state.value.lastUploadResult = 'failed';
      state.value.lastUploadResultText = 'scanner.upload.result.upload_failed';
      return 'error';
    } catch {
      // Network error — queue for offline retry
      state.value.lastUploadResult = 'failed';
      state.value.lastUploadResultText = 'scanner.upload.result.network_error_cached';
      enqueueOffline(text);
      return 'error';
    }
  }

  async function handleChannelExpired(): Promise<void> {
    try {
      const { shareCode: newCode, expireAt: newExpireAt } = await createChannel();
      state.value.shareCode = newCode;
      state.value.expireAt = newExpireAt;
      state.value.uploadCount = 0;
      state.value.lastUploadAt = null;
      state.value.lastScannedText = null;
      lastSuccessfulText = null;
      clearOfflineQueue();

      // Show rebuilt notification
      state.value.showRebuiltBanner = true;
      setTimeout(() => {
        state.value.showRebuiltBanner = false;
      }, 4000);

      state.value.status = 'scanning';
      state.value.errorMessage = null;
    } catch {
      state.value.status = 'error';
      state.value.errorMessage = 'scanner.error.rebuildFailed';
    }
  }

  // ── Main scan loop ──

  function startScanLoop(): void {
    if (scanTimer) return;

    scanTimer = setInterval(async () => {
      if (state.value.status !== 'scanning') return;

      // First, try to drain offline queue
      if (offlineQueue.length > 0) {
        await drainOfflineQueue();
      }

      const text = await scanFrame();
      if (!text) return;

      // Dedup: only upload if content changed from last successful upload
      if (text === lastSuccessfulText) return;

      // Rate limiting: if can't upload now, queue the latest text for later
      if (!canUpload()) {
        scheduleThrottledUpload(text);
        return;
      }

      const result = await uploadText(text);

      if (result === 'expired') {
        state.value.status = 'starting';
        await handleChannelExpired();
      }
    }, SCAN_INTERVAL_MS);
  }

  // ── Public API ──

  async function start(): Promise<void> {
    state.value.status = 'starting';
    state.value.errorMessage = null;

    try {
      const { shareCode: code, expireAt: expAt } = await createChannel();
      state.value.shareCode = code;
      state.value.expireAt = expAt;
      state.value.uploadCount = 0;
      state.value.lastUploadAt = null;
      state.value.lastUploadResult = 'idle';
      state.value.lastUploadResultText = null;
      state.value.lastScannedText = null;
      state.value.offlineQueueSize = 0;
      state.value.showRebuiltBanner = false;
      lastSuccessfulText = null;
      clearOfflineQueue();
      cancelThrottleTimer();

      state.value.status = 'scanning';
      startScanLoop();
    } catch (err) {
      state.value.status = 'error';
      state.value.errorMessage =
        err instanceof Error ? err.message : 'scanner.error.startFailed';
    }
  }

  async function stop(): Promise<void> {
    // Expire the channel on server so viewers get immediate notification
    if (state.value.shareCode) {
      try {
        await fetch('/api/channel/expire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareCode: state.value.shareCode }),
        });
      } catch {
        // Ignore — server may already be unreachable
      }
    }

    stopCamera();
    cancelThrottleTimer();
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    clearOfflineQueue();
    state.value = {
      status: 'idle',
      shareCode: null,
      uploadCount: 0,
      lastUploadAt: null,
      lastUploadResult: 'idle',
      lastUploadResultText: null,
      errorMessage: null,
      lastScannedText: null,
      expireAt: null,
      offlineQueueSize: 0,
      showRebuiltBanner: false,
    };
  }

  onUnmounted(() => {
    stop();
  });

  return {
    state,
    startCamera,
    start,
    stop,
  };
}
