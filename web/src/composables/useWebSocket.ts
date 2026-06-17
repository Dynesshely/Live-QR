import { ref, onUnmounted } from 'vue';
import type { ConnectionStatus, HistoryMessage, ServerMessage } from '../types';

const MAX_HISTORY = 200;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30000; // 30s
const NO_MESSAGE_TIMEOUT = 60000; // 60s

export function useWebSocket() {
  const status = ref<ConnectionStatus>('unconnected');
  const latestText = ref<string | null>(null);
  const messages = ref<HistoryMessage[]>([]);
  const viewerCount = ref<number>(0);
  const reconnectAttempt = ref<number>(0);
  const shareCode = ref<string | null>(null);
  const errorMessage = ref<string | null>(null);

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  let manualDisconnect = false;

  function buildWSUrl(code: string): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws?shareCode=${code}`;
  }

  function resetNoMessageTimer(): void {
    if (noMessageTimer) clearTimeout(noMessageTimer);
    noMessageTimer = setTimeout(() => {
      // No message from server in 60s — consider dead, trigger reconnect
      if (ws) {
        ws.close();
      }
    }, NO_MESSAGE_TIMEOUT);
  }

  function connectWS(): void {
    if (!shareCode.value) return;

    try {
      ws = new WebSocket(buildWSUrl(shareCode.value));

      ws.onopen = () => {
        // Connection established — welcome/history will arrive as messages
        resetNoMessageTimer();
      };

      ws.onmessage = (event: MessageEvent) => {
        resetNoMessageTimer();

        try {
          const msg: ServerMessage = JSON.parse(event.data);

          switch (msg.type) {
            case 'welcome':
              viewerCount.value = msg.viewerCount;
              if (status.value === 'reconnecting') {
                // Reconnected successfully
                reconnectAttempt.value = 0;
              }
              status.value = latestText.value ? 'connected' : 'waiting_data';
              break;

            case 'history':
              if (msg.messages.length > 0) {
                for (const m of msg.messages) {
                  // Dedup: skip if already present (prevents duplicates on reconnect)
                  const exists = messages.value.some(
                    existing => existing.data === m.data && existing.timestamp === m.timestamp,
                  );
                  if (!exists) {
                    prependMessage(m.data, m.timestamp);
                  }
                }
                latestText.value = msg.messages[msg.messages.length - 1].data;
                if (status.value !== 'connected') {
                  status.value = 'connected';
                }
              }
              break;

            case 'text':
              prependMessage(msg.data, msg.timestamp);
              latestText.value = msg.data;
              if (status.value !== 'connected') {
                status.value = 'connected';
              }
              break;

            case 'heartbeat':
              // Respond with pong
              ws?.send(JSON.stringify({ type: 'pong' }));
              break;

            case 'channel_expired':
              status.value = 'expired';
              errorMessage.value = msg.message;
              cleanupConnection();
              break;
          }
        } catch {
          // Ignore invalid JSON
        }
      };

      ws.onclose = (event: CloseEvent) => {
        ws = null;

        if (manualDisconnect) return;

        // If channel expired, don't reconnect
        if (status.value === 'expired') return;

        // Check if we were rejected
        if (event.code === 4001) {
          status.value = 'expired';
          errorMessage.value = 'viewer.error.invalidCode';
          return;
        }
        if (event.code === 4002) {
          status.value = 'expired';
          errorMessage.value = 'viewer.error.roomFull';
          return;
        }

        // Reconnect
        if (reconnectAttempt.value < MAX_RECONNECT_ATTEMPTS) {
          status.value = 'reconnecting';
          reconnectAttempt.value++;

          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt.value - 1),
            MAX_RECONNECT_DELAY,
          );

          reconnectTimer = setTimeout(() => {
            connectWS();
          }, delay);
        } else {
          status.value = 'unconnected';
          errorMessage.value = 'viewer.error.connectFailed';
        }
      };

      ws.onerror = () => {
        // onclose will fire after this — handle there
      };
    } catch {
      // Construction failed — will trigger reconnect logic in onclose
    }
  }

  function prependMessage(data: string, timestamp: number): void {
    messages.value = [{ data, timestamp }, ...messages.value].slice(0, MAX_HISTORY);
  }

  function cleanupConnection(): void {
    if (ws) {
      ws.onclose = null; // Prevent reconnect
      ws.close();
      ws = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (noMessageTimer) {
      clearTimeout(noMessageTimer);
      noMessageTimer = null;
    }
  }

  async function connect(code: string): Promise<void> {
    // Reset state
    manualDisconnect = false;
    reconnectAttempt.value = 0;
    errorMessage.value = null;
    shareCode.value = code;
    messages.value = [];
    latestText.value = null;
    status.value = 'verifying';

    // Verify share code first
    try {
      const resp = await fetch(`/api/channel/verify?shareCode=${code}`);
      const data = await resp.json();

      if (resp.status === 404 || resp.status === 400) {
        status.value = 'expired';
        errorMessage.value = data.message || 'viewer.error.codeNotFound';
        return;
      }

      if (resp.status === 429) {
        status.value = 'unconnected';
        errorMessage.value = data.message || 'viewer.error.rateLimited';
        return;
      }

      if (!resp.ok) {
        status.value = 'expired';
        errorMessage.value = data.message || 'viewer.error.verifyFailed';
        return;
      }

      // Valid — pre-populate latestText if available (history will come via WS)
      if (data.latestText) {
        latestText.value = data.latestText;
      }

      status.value = data.latestText ? 'connected' : 'waiting_data';
    } catch {
      status.value = 'unconnected';
      errorMessage.value = 'viewer.error.networkError';
      return;
    }

    // Connect WebSocket
    connectWS();
  }

  function disconnect(): void {
    manualDisconnect = true;
    cleanupConnection();
    status.value = 'unconnected';
    shareCode.value = null;
    messages.value = [];
    latestText.value = null;
    viewerCount.value = 0;
    reconnectAttempt.value = 0;
    errorMessage.value = null;
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    manualDisconnect = true;
    cleanupConnection();
  });

  return {
    status,
    latestText,
    messages,
    viewerCount,
    reconnectAttempt,
    shareCode,
    errorMessage,
    connect,
    disconnect,
  };
}
