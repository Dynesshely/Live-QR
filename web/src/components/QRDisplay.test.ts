import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import QRDisplay from './QRDisplay.vue';
import { QR_MAX_PAYLOAD_BYTES } from '../composables/useQRCode';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import ja from '../locales/ja.json';

function makeI18n(locale: 'en' | 'zh' | 'ja' = 'zh') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, zh, ja } });
}

// happy-dom 没有真正的 canvas 实现，qrcode 渲染需要最小 2d 上下文
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype.getContext as any) = vi.fn((contextId: string) => {
    if (contextId === '2d') {
      return {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: vi.fn(),
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(128),
          width: w,
          height: h,
        }),
        canvas: { width: 256, height: 256 },
      } as unknown as CanvasRenderingContext2D;
    }
    return null;
  });
});

describe('QRDisplay', () => {
  it('renders a QR code for normal payloads', async () => {
    const wrapper = mount(QRDisplay, {
      props: { text: 'https://example.com', status: 'connected' },
      global: { plugins: [makeI18n()] },
    });

    await flushPromises();
    expect(wrapper.find('canvas').exists()).toBe(true);
    expect(wrapper.text()).not.toContain(zh.viewer.qr.tooLongTitle);
  });

  it('explains capacity overflow instead of leaving a blank canvas', async () => {
    const text = '字'.repeat(700); // 2100 bytes > 1273
    const wrapper = mount(QRDisplay, {
      props: { text, status: 'connected' },
      global: { plugins: [makeI18n()] },
    });

    await flushPromises();

    expect(wrapper.text()).toContain(zh.viewer.qr.tooLongTitle);
    expect(wrapper.text()).toContain(String(new TextEncoder().encode(text).length));
    expect(wrapper.text()).toContain(String(QR_MAX_PAYLOAD_BYTES));
    // 原文仍然完整展示，可复制
    expect(wrapper.text()).toContain(text);
    // 画布被隐藏（v-show → display:none），不会留下一块空白
    expect((wrapper.find('canvas').element as HTMLElement).style.display).toBe('none');
  });
});
