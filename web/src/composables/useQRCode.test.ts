import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQRCode } from './useQRCode.js';

// happy-dom doesn't implement canvas fully; provide a minimal mock
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
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

  it('uses correct default dimensions', async () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    await generate(canvas, 'test');
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
  });

  it('throws on empty input text', () => {
    const { generate } = useQRCode();
    const canvas = document.createElement('canvas');

    expect(() => generate(canvas, '')).rejects.toThrow('No input text');
  });
});
