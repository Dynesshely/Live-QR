import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQRCode, QR_BITMAP_SIZE } from './useQRCode.js';

// happy-dom doesn't implement canvas fully; provide a minimal mock
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

describe('useQRCode', () => {
  it('exposes generate function', () => {
    const { generate } = useQRCode();
    expect(typeof generate).toBe('function');
  });

  it('generates QR code to canvas element', async () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    await generate(canvas, 'https://example.com');
    // If no error thrown, QR was generated successfully
    expect(canvas).toBeDefined();
  });

  it('renders the bitmap at QR_BITMAP_SIZE', async () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    await generate(canvas, 'test');
    expect(canvas.width).toBe(QR_BITMAP_SIZE);
    expect(canvas.height).toBe(QR_BITMAP_SIZE);
  });

  // 回归防护：qrcode 的 canvas renderer 会写 canvas.style.width/height 内联样式，
  // 它会盖掉 Tailwind 的 w-full，导致画布被锁死在固定像素上 ——
  // 表现为 QR 卡片不再正方、且右侧留白明显大于左侧。
  it('clears the inline size written by qrcode so CSS controls layout', async () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    await generate(canvas, 'test');
    expect(canvas.style.width).toBe('');
    expect(canvas.style.height).toBe('');
  });

  it('throws on empty input text', async () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    // 必须 await：漏掉 await 的 rejects 断言不会真正执行，测试形同虚设
    await expect(generate(canvas, '')).rejects.toThrow('No input text');
  });
});
