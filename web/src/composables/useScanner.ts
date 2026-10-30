import { ref, onUnmounted } from 'vue';
import { fetchWithTimeout, API_TIMEOUT_MS, EXPIRE_TIMEOUT_MS } from '../utils/fetch';
import {
  applyUploadOutcome,
  classifyUploadStatus,
  serverErrorKey,
  type UploadDedupState,
  type UploadOutcome,
} from '../utils/upload';
import { computeCoverCrop } from '../utils/scan';

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

/** 扫码帧间隔 */
export const SCAN_INTERVAL_MS = 250;
/** 两次上传之间的最小间隔（服务端限流 2 次/秒） */
export const MIN_UPLOAD_GAP_MS = 500;
/** 离线队列容量 —— UI 的 `{max}` 也引用这个常量，不要在模板里硬编码 */
export const OFFLINE_QUEUE_MAX = 6;
/** 等待 videoWidth/videoHeight 就绪的上限，超时视为摄像头启动失败 */
export const VIDEO_METADATA_TIMEOUT_MS = 10000;
/** 解码用的最大边长：二维码识别不需要原始分辨率，缩到 640 省 CPU */
export const DECODE_MAX_EDGE = 640;

/**
 * 429 后的补偿重试：服务端滑动窗口是 1s，退避 1s 再试一次即可；
 * 上限 2 次，避免用一条内容把限流额度持续吃满。
 */
const RATE_LIMIT_RETRY_DELAY_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 2;

/**
 * jsQR 的模块级单例加载器。
 *
 * 原来每 250ms 一帧都 `await import('jsqr')` —— 虽然模块本身已被缓存，
 * 但每帧仍要走一次动态 import 的解析/微任务链路，是白白的每帧开销。
 * 这里只保留一次懒加载：既满足「只加载一次」，又不把 250KB 的解码器塞进
 * 首屏 bundle（观看端永远不会用到 jsqr）。
 */
let jsQRLoader: Promise<typeof import('jsqr').default> | null = null;

function loadJsqr(): Promise<typeof import('jsqr').default> {
  if (!jsQRLoader) {
    jsQRLoader = import('jsqr').then((mod) => mod.default);
  }
  return jsQRLoader;
}

/**
 * 离线队列与去重基准放在模块级。
 *
 * ScannerView 由 `v-if` 切换，组件卸载会重建 composable 实例：队列若放在实例内部，
 * 「切回首页再进来」必丢（HANDOFF-AUDIT §4.5）。队列只在**换新通道**时清空
 * （start() 建新通道 / 通道过期自动重建），切模式退出时保留。
 * 前提：同一时刻只有一个扫描实例（当前应用就是这样），多实例会共享同一条队列。
 */
const offlineQueue: string[] = [];

/**
 * 去重基准（模块级，与队列同生命周期），规则见 utils/upload.ts 的
 * applyUploadOutcome：
 * - lastAcceptedText：服务端已接受**或限流**的内容（429 也更新，防止每帧重发）；
 * - dedup.lastRejectedText：被永久拒绝（4xx）的内容，不再重试、也不入队。
 * 只在内容变化或换新通道时重置。
 */
const dedup: UploadDedupState = { lastAcceptedText: null, lastRejectedText: null };

function resetDedup(): void {
  dedup.lastAcceptedText = null;
  dedup.lastRejectedText = null;
}

interface JsonRecord {
  [key: string]: unknown;
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? (value as JsonRecord) : null;
}

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
    offlineQueueSize: offlineQueue.length,
    showRebuiltBanner: false,
  });

  let videoEl: HTMLVideoElement | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let canvasCtx: CanvasRenderingContext2D | null = null;
  let stream: MediaStream | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  /** onUnmounted 与手动返回都会调 stop()，用它保证只发一次 expire */
  let stopping = false;
  /**
   * 会话令牌：start() 在 await 建通道期间用户可能已经点了返回。
   * 令牌一变，迟到的 start() 必须停止推进，并把刚建出来的通道立即过期掉，
   * 否则会出现「摄像头已关、界面上却开始扫码」以及服务端留下一个孤儿通道。
   */
  let sessionToken = 0;

  // ── Offline cache queue ──

  function enqueueOffline(text: string): void {
    // 按内容去重：同一条文本只保留一份，避免重复帧把队列挤满
    if (offlineQueue.includes(text)) return;
    // 满则丢最旧的
    if (offlineQueue.length >= OFFLINE_QUEUE_MAX) {
      offlineQueue.shift();
    }
    offlineQueue.push(text);
    state.value.offlineQueueSize = offlineQueue.length;
  }

  function dequeueOffline(): void {
    offlineQueue.shift();
    state.value.offlineQueueSize = offlineQueue.length;
  }

  async function drainOfflineQueue(): Promise<void> {
    while (offlineQueue.length > 0) {
      const text = offlineQueue[0];

      // 已经成功上传过同一内容，无需重发
      if (text === dedup.lastAcceptedText) {
        dequeueOffline();
        continue;
      }

      const outcome = await uploadText(text);

      if (outcome === 'rejected') {
        // 永久性拒绝：丢掉这条继续下一条，绝不留在队列里反复重试
        dequeueOffline();
        continue;
      }
      if (outcome === 'expired') {
        dequeueOffline();
        break;
      }
      if (outcome === 'network_error' || outcome === 'rate_limited') {
        // 网络还没恢复 / 仍在限流，停止排空，下一轮再试
        break;
      }
      // accepted
      dequeueOffline();
    }
  }

  /** 换新通道时清空旧通道的离线文本（旧文本属于已失效的通道） */
  function clearOfflineQueue(): void {
    offlineQueue.length = 0;
    state.value.offlineQueueSize = 0;
  }

  // ── Throttle queuing ──

  let pendingThrottleText: string | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleThrottledUpload(text: string): void {
    // 只保留最新文本（中间内容直接合并）
    pendingThrottleText = text;

    if (throttleTimer) return; // already scheduled

    throttleTimer = setTimeout(async () => {
      throttleTimer = null;
      const pending = pendingThrottleText;
      pendingThrottleText = null;
      if (!pending) return;

      // 与服务端已确认的内容相同、或已被明确拒绝的内容，都不再重复上传
      if (pending === dedup.lastAcceptedText || pending === dedup.lastRejectedText) return;

      const outcome = await uploadText(pending);
      if (outcome === 'rate_limited') {
        scheduleRateLimitRetry(pending);
      }
    }, MIN_UPLOAD_GAP_MS);
  }

  let rateLimitRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let rateLimitRetryText: string | null = null;
  let rateLimitRetryCount = 0;

  /**
   * 429 之后的一次性补偿重试。
   *
   * 429 会更新去重基准（避免扫描循环每 250ms 重发），但「更新基准」本身意味着
   * 这条内容不会再自动重发；服务端限流窗口只有 1s，所以这里按退避补发一次，
   * 最多 MAX_RATE_LIMIT_RETRIES 次，失败就留在「限流等待中」状态，不再纠缠。
   */
  function scheduleRateLimitRetry(text: string): void {
    if (rateLimitRetryText !== text) {
      rateLimitRetryText = text;
      rateLimitRetryCount = 0;
    }
    if (rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) return;
    if (rateLimitRetryTimer) return;

    rateLimitRetryCount++;
    rateLimitRetryTimer = setTimeout(async () => {
      rateLimitRetryTimer = null;
      const outcome = await uploadText(text);
      if (outcome === 'rate_limited') {
        scheduleRateLimitRetry(text);
      }
    }, RATE_LIMIT_RETRY_DELAY_MS);
  }

  function cancelThrottleTimer(): void {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    pendingThrottleText = null;

    if (rateLimitRetryTimer) {
      clearTimeout(rateLimitRetryTimer);
      rateLimitRetryTimer = null;
    }
    rateLimitRetryText = null;
    rateLimitRetryCount = 0;
  }

  // ── Camera ──

  /** 释放当前 MediaStream（停止全部 track 并解除 video 绑定） */
  function releaseStream(): void {
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  /**
   * 等待 videoWidth/videoHeight 就绪。
   *
   * 原实现是无超时的 requestAnimationFrame 递归：摄像头不出帧（驱动异常、被其它
   * 应用占用）时这个 Promise 永远不 resolve，UI 卡在「正在启动摄像头」。
   */
  function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }

      let rafId = 0;
      const timer = setTimeout(() => {
        if (rafId) cancelAnimationFrame(rafId);
        reject(new Error('scanner.error.videoTimeout'));
      }, timeoutMs);

      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          clearTimeout(timer);
          resolve();
          return;
        }
        rafId = requestAnimationFrame(check);
      };
      rafId = requestAnimationFrame(check);
    });
  }

  async function startCamera(videoElement: HTMLVideoElement): Promise<void> {
    // 重试路径：先关掉上一次遗留的流，否则旧 track 会继续占用摄像头
    releaseStream();
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
      // play() 返回 Promise：不处理会在部分浏览器里抛出未捕获的 NotAllowedError。
      // 用可选链兜住历史上返回 void 的实现，避免 .catch 本身抛 TypeError。
      void videoEl.play()?.catch?.(() => undefined);

      canvasEl = document.createElement('canvas');
      canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });

      await waitForVideoDimensions(videoEl, VIDEO_METADATA_TIMEOUT_MS);
    } catch (err) {
      // 启动失败必须把已经开出来的流关掉 —— 否则权限被撤销/元数据超时后，
      // 摄像头指示灯还亮着，用户会认为页面在偷偷录像。
      releaseStream();
      canvasEl = null;
      canvasCtx = null;

      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        throw new Error('scanner.error.permissionDenied');
      }
      if (err instanceof Error && err.message.startsWith('scanner.error.')) {
        throw err;
      }
      throw new Error(
        `scanner.error.cameraGeneric::${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function stopScanLoop(): void {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  }

  function stopCamera(): void {
    stopScanLoop();
    cancelThrottleTimer();
    releaseStream();
    videoEl = null;
    canvasEl = null;
    canvasCtx = null;
  }

  // ── QR Decoding ──

  async function scanFrame(): Promise<string | null> {
    if (!videoEl || !canvasEl || !canvasCtx) return null;

    try {
      // 解码区域 = object-cover 下实际可见的区域，保证「所见即所扫」
      const crop = computeCoverCrop(
        videoEl.videoWidth,
        videoEl.videoHeight,
        videoEl.clientWidth,
        videoEl.clientHeight,
      );

      const scale = Math.min(1, DECODE_MAX_EDGE / Math.max(crop.sw, crop.sh));
      const targetWidth = Math.max(1, Math.floor(crop.sw * scale));
      const targetHeight = Math.max(1, Math.floor(crop.sh * scale));

      // 尺寸不变就不重设 canvas（重设会清空上下文状态，是每帧的无谓开销）
      if (canvasEl.width !== targetWidth || canvasEl.height !== targetHeight) {
        canvasEl.width = targetWidth;
        canvasEl.height = targetHeight;
      }

      canvasCtx.drawImage(
        videoEl,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        targetWidth,
        targetHeight,
      );
      const imageData = canvasCtx.getImageData(0, 0, targetWidth, targetHeight);

      const jsQR = await loadJsqr();
      const code = jsQR(imageData.data, targetWidth, targetHeight, {
        inversionAttempts: 'dontInvert',
      });

      return code?.data ?? null;
    } catch {
      return null;
    }
  }

  // ── Channel management ──

  async function createChannel(): Promise<{ shareCode: string; expireAt: string }> {
    let resp: Response;
    try {
      resp = await fetchWithTimeout('/api/channel/create', { method: 'POST' }, API_TIMEOUT_MS);
    } catch {
      throw new Error('scanner.error.createChannelFailed');
    }
    if (!resp.ok) throw new Error('scanner.error.createChannelFailed');

    const payload = readRecord(await resp.json().catch(() => null));
    const data = readRecord(payload?.data);
    const shareCode = data?.shareCode;
    const expireAt = data?.expireAt;

    if (typeof shareCode !== 'string' || shareCode.length === 0) {
      throw new Error('scanner.error.createChannelFailed');
    }
    return { shareCode, expireAt: typeof expireAt === 'string' ? expireAt : '' };
  }

  // ── Upload ──

  function canUpload(): boolean {
    if (!state.value.lastUploadAt) return true;
    return Date.now() - state.value.lastUploadAt >= MIN_UPLOAD_GAP_MS;
  }

  /** 读取服务端错误码并映射到本地化键；解析失败则回退到通用文案 */
  async function readUploadErrorKey(resp: Response): Promise<string> {
    const payload = readRecord(await resp.json().catch(() => null));
    return serverErrorKey(payload?.error) ?? 'scanner.upload.result.rejected';
  }

  async function uploadText(text: string): Promise<UploadOutcome> {
    const shareCode = state.value.shareCode;
    if (!shareCode) return 'rejected';

    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        '/api/upload',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareCode, text }),
        },
        API_TIMEOUT_MS,
      );
    } catch {
      // 网络错误（含超时）—— 唯一应该进入离线队列的失败类型
      state.value.lastUploadResult = 'failed';
      state.value.lastUploadResultText = 'scanner.upload.result.network_error_cached';
      enqueueOffline(text);
      return 'network_error';
    }

    const outcome = classifyUploadStatus(resp.status);

    // 去重基准由结果驱动（ok/429 记录已接受，4xx 记录永久拒绝），见 applyUploadOutcome
    Object.assign(dedup, applyUploadOutcome(dedup, outcome, text));

    switch (outcome) {
      case 'ok': {
        state.value.uploadCount++;
        state.value.lastUploadAt = Date.now();
        state.value.lastUploadResult = 'success';
        state.value.lastUploadResultText = null;
        state.value.lastScannedText = text;
        return 'ok';
      }

      case 'rate_limited': {
        state.value.lastUploadResult = 'rate_limited';
        state.value.lastUploadResultText = 'scanner.upload.result.rate_limited';
        // 429 也会更新去重基准（applyUploadOutcome）+ 节流时间：否则扫描循环
        // 每 250ms 就会把同一条内容再发一次，既必然再次 429，又把限流额度吃满。
        state.value.lastUploadAt = Date.now();
        return 'rate_limited';
      }

      case 'expired': {
        state.value.lastUploadResult = 'failed';
        state.value.lastUploadResultText = 'scanner.upload.result.channel_expired';
        return 'expired';
      }

      case 'network_error': {
        // 5xx 属于服务端临时故障，可以重试
        state.value.lastUploadResult = 'failed';
        state.value.lastUploadResultText = 'scanner.upload.result.upload_failed';
        enqueueOffline(text);
        return 'network_error';
      }

      case 'rejected': {
        // 其余 4xx（含 400 TEXT_TOO_LONG）是永久性拒绝：不入队、不重试，直接提示。
        // applyUploadOutcome 已把文本记进 lastRejectedText，扫描循环不会再试。
        state.value.lastUploadResult = 'failed';
        state.value.lastUploadResultText = await readUploadErrorKey(resp);
        return 'rejected';
      }
    }
  }

  async function handleChannelExpired(): Promise<void> {
    const token = sessionToken;
    try {
      const { shareCode: newCode, expireAt: newExpireAt } = await createChannel();

      if (token !== sessionToken) {
        // 重建期间用户已经退出：别把刚建出来的通道留在服务端
        expireChannel(newCode);
        return;
      }

      state.value.shareCode = newCode;
      state.value.expireAt = newExpireAt;
      state.value.uploadCount = 0;
      state.value.lastUploadAt = null;
      state.value.lastScannedText = null;
      resetDedup();
      // 新通道：旧通道的离线文本不再适用
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

      // Dedup: only upload if content changed since the last accepted/rejected upload
      if (text === dedup.lastAcceptedText || text === dedup.lastRejectedText) return;

      // Rate limiting: if can't upload now, queue the latest text for later
      if (!canUpload()) {
        scheduleThrottledUpload(text);
        return;
      }

      const result = await uploadText(text);

      if (result === 'rate_limited') {
        scheduleRateLimitRetry(text);
        return;
      }

      if (result === 'expired') {
        state.value.status = 'starting';
        await handleChannelExpired();
      }
    }, SCAN_INTERVAL_MS);
  }

  // ── Public API ──

  function resetState(): void {
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
      // 队列保留（只在换新通道时清空），计数必须与真实队列长度一致
      offlineQueueSize: offlineQueue.length,
      showRebuiltBanner: false,
    };
  }

  /** 通知服务端通道作废（best-effort：带超时、不 await、失败即忽略） */
  function expireChannel(shareCode: string): void {
    void fetchWithTimeout(
      '/api/channel/expire',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareCode }),
      },
      EXPIRE_TIMEOUT_MS,
    ).catch(() => {
      // 服务端可能已不可达 —— 过期是 best-effort
    });
  }

  async function start(): Promise<void> {
    stopping = false;
    const token = ++sessionToken;
    state.value.status = 'starting';
    state.value.errorMessage = null;

    try {
      const { shareCode: code, expireAt: expAt } = await createChannel();

      if (token !== sessionToken) {
        // 建通道期间用户已经退出：不要再启动扫码，顺手把这个孤儿通道作废
        expireChannel(code);
        return;
      }

      state.value.shareCode = code;
      state.value.expireAt = expAt;
      state.value.uploadCount = 0;
      state.value.lastUploadAt = null;
      state.value.lastUploadResult = 'idle';
      state.value.lastUploadResultText = null;
      state.value.lastScannedText = null;
      state.value.showRebuiltBanner = false;
      resetDedup();
      // 新通道 → 清空旧通道遗留的离线文本
      clearOfflineQueue();
      cancelThrottleTimer();

      state.value.status = 'scanning';
      startScanLoop();
    } catch (err) {
      // 建通道失败也必须关摄像头，不能在页面上留一个仍在录制的流
      stopCamera();
      state.value.status = 'error';
      state.value.errorMessage =
        err instanceof Error ? err.message : 'scanner.error.startFailed';
    }
  }

  /**
   * 停止扫码。
   *
   * 顺序是刻意的：**先**关摄像头（隐私优先），**再**发 expire（best-effort，
   * 带超时且不 await）。原先先 await expire 再关流，网络半通时摄像头会一直亮着。
   * 同步函数 + `stopping` 标志：手动返回会调用一次，onUnmounted 再调用一次，
   * 但 expire 只会发一次。
   */
  function stop(): void {
    if (stopping) return;
    stopping = true;

    // 作废进行中的 start()：迟到的建通道结果不得再推进状态
    sessionToken++;

    const shareCode = state.value.shareCode;

    // 1. 先关摄像头
    stopCamera();
    stopScanLoop();
    cancelThrottleTimer();

    resetDedup();
    resetState();

    // 2. 再通知服务端（不阻塞、不重试、失败即忽略）
    if (shareCode) {
      expireChannel(shareCode);
    }
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