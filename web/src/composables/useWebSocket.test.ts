import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { useWebSocket } from './useWebSocket';
import type { ConnectionStatus } from '../types';

/** 极简 WebSocket 替身：只保留测试需要的事件入口 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** 模拟服务端下发一条 JSON 消息 */
  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** 模拟服务端关闭连接 */
  closeWith(code: number): void {
    this.onclose?.({ code });
  }
}

let api: ReturnType<typeof useWebSocket> | null = null;

/** 唯一组件：composable 用了 onUnmounted，必须挂在组件实例里 */
const Harness = defineComponent({
  setup() {
    api = useWebSocket();
    return () => h('div');
  },
});

function okVerifyResponse(): Response {
  return new Response(JSON.stringify({ code: 200, valid: true, latestText: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useWebSocket', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    api = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okVerifyResponse()),
    );
  });

  afterEach(() => {
    api?.disconnect();
    wrapper?.unmount();
    wrapper = null;
    api = null;
    vi.unstubAllGlobals();
  });

  async function connect(): Promise<{ api: ReturnType<typeof useWebSocket>; socket: FakeWebSocket }> {
    wrapper = mount(Harness);

    await api!.connect('12345678');
    await flushPromises();

    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    expect(socket).toBeDefined();
    return { api: api!, socket };
  }

  it('updates the viewer count when the server broadcasts viewer_count', async () => {
    const { api: ws, socket } = await connect();

    socket.emit({ type: 'welcome', shareCode: '12345678', viewerCount: 1 });
    expect(ws.viewerCount.value).toBe(1);

    socket.emit({ type: 'viewer_count', count: 4 });
    expect(ws.viewerCount.value).toBe(4);
  });

  it('accepts the legacy viewerCount field for viewer_count', async () => {
    const { api: ws, socket } = await connect();

    socket.emit({ type: 'viewer_count', viewerCount: 7 });
    expect(ws.viewerCount.value).toBe(7);
  });

  it('treats channel_expired as expired and never shows the server message', async () => {
    const { api: ws, socket } = await connect();

    socket.emit({
      type: 'channel_expired',
      code: 'CHANNEL_EXPIRED',
      message: '该分享码已过期（30 分钟无上传）',
    });

    expect(ws.status.value).toBe<ConnectionStatus>('expired');
    expect(ws.errorKind.value).toBe('expired');
    // 服务端中文文案绝不能直接进 UI：这里必须是 i18n 键
    expect(ws.errorMessage.value).toBe('viewer.error.channelExpired');
  });

  it('treats close code 1001 as expired without reconnecting', async () => {
    const { api: ws, socket } = await connect();

    socket.closeWith(1001);

    expect(ws.status.value).toBe<ConnectionStatus>('expired');
    expect(ws.errorKind.value).toBe('expired');
  });

  it('distinguishes 4001 (invalid code) from 4002 (room full)', async () => {
    const first = await connect();
    first.socket.closeWith(4001);
    expect(first.api.status.value).toBe<ConnectionStatus>('expired');
    expect(first.api.errorKind.value).toBe('invalid_code');
    expect(first.api.errorMessage.value).toBe('viewer.error.invalidCode');

    first.api.disconnect();
    wrapper?.unmount();
    wrapper = null;
    api = null;

    const second = await connect();
    second.socket.closeWith(4002);
    expect(second.api.errorKind.value).toBe('room_full');
    expect(second.api.errorMessage.value).toBe('viewer.error.roomFull');
  });

  it('keeps retrying with exponential backoff for ordinary network closes', async () => {
    const { api: ws, socket } = await connect();

    socket.closeWith(1006);

    expect(ws.status.value).toBe<ConnectionStatus>('reconnecting');
    expect(ws.reconnectAttempt.value).toBe(1);
  });

  it('keeps the user on the input page when verification is rejected', async () => {
    wrapper = mount(Harness);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 429, error: 'VERIFY_RATE_LIMITED' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await api!.connect('12345678');
    await flushPromises();

    // 429 属于「可重试」，不应把用户丢进仪表盘（保持 unconnected）
    expect(api!.status.value).toBe<ConnectionStatus>('unconnected');
    expect(api!.errorKind.value).toBe('rate_limited');
    expect(api!.errorMessage.value).toBe('serverErrors.VERIFY_RATE_LIMITED');
    expect(api!.sessionStarted.value).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
