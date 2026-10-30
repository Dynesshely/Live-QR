import { ref, onUnmounted } from 'vue';
import type {
  ConnectionStatus,
  HistoryMessage,
  ServerMessage,
  ViewerErrorKind,
} from '../types';
import { fetchWithTimeout, API_TIMEOUT_MS } from '../utils/fetch';
import { serverErrorKey } from '../utils/upload';
import { classifyCloseCode } from '../utils/ws';

const MAX_HISTORY = 200;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 1000; // 1s
const NO_MESSAGE_TIMEOUT_MS = 60000; // 60s

/**
 * 退避序列（5 次上限）：1s → 2s → 4s → 8s → 16s。
 * 原先还定义了 MAX_RECONNECT_DELAY = 30000 并在 Math.min 里用它，但第 5 次退避
 * 只到 16s，30s 永远不可达（HANDOFF-AUDIT §1.5）—— 删掉这个死常量，
 * 避免下一个人以为封顶是 30s。要改上限只改 MAX_RECONNECT_ATTEMPTS。
 */

interface JsonRecord {
  [key: string]: unknown;
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? (value as JsonRecord) : null;
}

export function useWebSocket() {
  const status = ref<ConnectionStatus>('unconnected');
  const latestText = ref<string | null>(null);
  const messages = ref<HistoryMessage[]>([]);
  const viewerCount = ref<number>(0);
  const reconnectAttempt = ref<number>(0);
  const shareCode = ref<string | null>(null);
  const errorMessage = ref<string | null>(null);
  const errorKind = ref<ViewerErrorKind>('none');
  /**
   * 是否已经通过「验证」进入过会话。
   *
   * App.vue 用它区分两种 expired：
   * - 验证阶段就失败（分享码不存在 / 参数非法）→ 应留在输入页显示错误；
   * - 已经在看的通道后来过期（1001）→ 应留在仪表盘并显示过期横幅。
   */
  const sessionStarted = ref(false);

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let noMessageTimer: ReturnType<typeof setTimeout> | null = null;
  let manualDisconnect = false;

  function buildWSUrl(code: string): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws?shareCode=${encodeURIComponent(code)}`;
  }

  function resetNoMessageTimer(): void {
    if (noMessageTimer) clearTimeout(noMessageTimer);
    noMessageTimer = setTimeout(() => {
      // No message from server in 60s — consider dead, trigger reconnect
      if (ws) {
        ws.close();
      }
    }, NO_MESSAGE_TIMEOUT_MS);
  }

  /** 统一的失败落点：状态置为 expired + 分类 + i18n 键 */
  function fail(kind: Exclude<ViewerErrorKind, 'none'>, key: string): void {
    errorKind.value = kind;
    errorMessage.value = key;
    status.value = 'expired';
  }

  function connectWS(): void {
    if (!shareCode.value) return;
    // 已有一条连接时不要重复建链（旧实现可能在同一时刻挂两条 socket）
    if (ws) return;

    try {
      const socket = new WebSocket(buildWSUrl(shareCode.value));
      ws = socket;

      socket.onopen = () => {
        // Connection established — welcome/history will arrive as messages
        resetNoMessageTimer();
      };

      socket.onmessage = (event: MessageEvent) => {
        resetNoMessageTimer();

        try {
          const msg: ServerMessage = JSON.parse(event.data);

          switch (msg.type) {
            case 'welcome':
              if (typeof msg.viewerCount === 'number') {
                viewerCount.value = msg.viewerCount;
              }
              if (status.value === 'reconnecting') {
                // Reconnected successfully
                reconnectAttempt.value = 0;
              }
              status.value = latestText.value ? 'connected' : 'waiting_data';
              break;

            case 'viewer_count': {
              const count = typeof msg.count === 'number' ? msg.count : msg.viewerCount;
              if (typeof count === 'number' && count >= 0) {
                viewerCount.value = count;
              }
              break;
            }

            case 'history':
              if (msg.messages.length > 0) {
                for (const m of msg.messages) {
                  // Dedup: skip if already present (prevents duplicates on reconnect)
                  const exists = messages.value.some(
                    (existing) => existing.data === m.data && existing.timestamp === m.timestamp,
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
              socket.send(JSON.stringify({ type: 'pong' }));
              break;

            case 'channel_expired':
              // 只认 type / code（服务端契约：code: 'CHANNEL_EXPIRED'）。
              // message 仅用于兼容旧服务端，绝不直接显示 —— 历史版本是硬编码中文，
              // 会在 EN/JA 界面里原样漏出来（HANDOFF-AUDIT §4.14）。
              fail('expired', 'viewer.error.channelExpired');
              cleanupConnection();
              break;
          }
        } catch {
          // Ignore invalid JSON
        }
      };

      socket.onclose = (event: CloseEvent) => {
        // 只清掉自己这条引用，避免旧 socket 的 onclose 把新连接置空
        if (ws === socket) ws = null;

        if (manualDisconnect) return;

        // If channel expired, don't reconnect
        if (status.value === 'expired') return;

        const { kind, reconnect } = classifyCloseCode(event.code);
        if (kind === 'expired') {
          fail('expired', 'viewer.error.channelExpired');
          return;
        }
        if (kind === 'invalid_code') {
          fail('invalid_code', 'viewer.error.invalidCode');
          return;
        }
        if (kind === 'room_full') {
          fail('room_full', 'viewer.error.roomFull');
          return;
        }
        if (!reconnect) {
          status.value = 'unconnected';
          return;
        }

        // Reconnect
        if (reconnectAttempt.value < MAX_RECONNECT_ATTEMPTS) {
          status.value = 'reconnecting';
          reconnectAttempt.value++;

          const delay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempt.value - 1);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectWS();
          }, delay);
        } else {
          status.value = 'unconnected';
          errorKind.value = 'connect_failed';
          errorMessage.value = 'viewer.error.connectFailed';
        }
      };

      socket.onerror = () => {
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
    // 先清掉上一条连接与所有定时器，避免旧 socket 的回调（onclose/onmessage）
    // 在新会话开始后仍能改写 status / 触发一次多余重连。
    cleanupConnection();

    manualDisconnect = false;
    reconnectAttempt.value = 0;
    errorMessage.value = null;
    errorKind.value = 'none';
    sessionStarted.value = false;
    shareCode.value = code;
    messages.value = [];
    latestText.value = null;
    viewerCount.value = 0;
    status.value = 'verifying';

    // Verify share code first
    let resp: Response;
    try {
      resp = await fetchWithTimeout(
        `/api/channel/verify?shareCode=${encodeURIComponent(code)}`,
        {},
        API_TIMEOUT_MS,
      );
    } catch {
      status.value = 'unconnected';
      errorKind.value = 'network';
      errorMessage.value = 'viewer.error.networkError';
      return;
    }

    const payload = readRecord(await resp.json().catch(() => null));
    // 服务端错误码 → 本地化文案；未知码回退到通用键
    const mappedError = serverErrorKey(payload?.error);
    const latest = payload?.latestText;

    if (resp.status === 404 || resp.status === 400) {
      fail('invalid_code', mappedError ?? 'viewer.error.codeNotFound');
      return;
    }

    if (resp.status === 429) {
      status.value = 'unconnected';
      errorKind.value = 'rate_limited';
      errorMessage.value = mappedError ?? 'viewer.error.rateLimited';
      return;
    }

    if (!resp.ok) {
      if (resp.status >= 500) {
        // 服务端临时故障：留在输入页，允许用户再提交一次
        status.value = 'unconnected';
        errorKind.value = 'network';
        errorMessage.value = mappedError ?? 'viewer.error.networkError';
      } else {
        fail('verify_failed', mappedError ?? 'viewer.error.verifyFailed');
      }
      return;
    }

    // Valid — pre-populate latestText if available (history will come via WS)
    sessionStarted.value = true;
    if (typeof latest === 'string' && latest.length > 0) {
      latestText.value = latest;
    }

    status.value = latestText.value ? 'connected' : 'waiting_data';

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
    errorKind.value = 'none';
    sessionStarted.value = false;
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
    errorKind,
    sessionStarted,
    connect,
    disconnect,
  };
}
