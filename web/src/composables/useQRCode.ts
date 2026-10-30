import { ref } from 'vue';
import QRCode from 'qrcode';

/**
 * 位图分辨率 —— 注意它**不等于**显示尺寸，显示尺寸完全交给 CSS。
 *
 * 取 1024 的理由：卡片宽度上限 320px（QRDisplay 的 max-w-80 减内边距），
 * 画布最大约 280 CSS px；在 DPR 3 的屏幕上需要约 840 物理像素，
 * 1024 足以覆盖而无需放大位图。二维码一旦被插值放大就会发虚，
 * 直接影响对端摄像头能否识别，所以宁可位图大一点让它被缩小显示。
 * 同时它也是两个 <canvas> 的初始 width/height 属性值（见 QRDisplay / HistoryList），
 * 避免「先按 256 画一帧再被替换」的多余重排。
 */
export const QR_BITMAP_SIZE = 1024;

/**
 * 二维码容量上限（EC=H，version 40，Byte 模式）= 1273 字节。
 *
 * 说明与取舍：
 * - 这里用的是**保守的 Byte 模式上限**。qrcode 库会按内容自动选择 Numeric/Alphanumeric
 *   /Byte 分段，纯数字内容实际能装更多（H 级 numeric 约 3057 位），所以这个常量
 *   只用于「已经超限时给出准确的字节数/上限提示」，**不作为提前拒绝的依据**；
 *   真正能否编码仍以库的结果为准（见 generate 的 catch）。
 * - 服务端 MAX_TEXT_LENGTH 默认 2000 **字符**，中文按 UTF-8 是 3 字节/字，
 *   因此 2000 个汉字约 6000 字节，远超上限 —— 历史 bug 就是这里静默失败、
 *   卡片留白且没有任何提示（HANDOFF-AUDIT §4.1）。现在是显式失败 + 本地化提示。
 */
export const QR_MAX_PAYLOAD_BYTES = 1273;

export interface QRPayloadSize {
  /** UTF-8 字节数（与 qrcode 的编码输入一致） */
  bytes: number;
  maxBytes: number;
  overflow: boolean;
}

/** 读取 UTF-8 字节数；TextEncoder 在浏览器与 happy-dom 下都可用 */
export function measureQRPayload(text: string): QRPayloadSize {
  const bytes = new TextEncoder().encode(text).length;
  return { bytes, maxBytes: QR_MAX_PAYLOAD_BYTES, overflow: bytes > QR_MAX_PAYLOAD_BYTES };
}

/** 内容超过二维码容量：携带实际字节数与上限，供 UI 展示 */
export class QRPayloadTooLargeError extends Error {
  readonly code = 'QR_PAYLOAD_TOO_LARGE';
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(bytes: number, maxBytes: number) {
    super(`QR payload too large: ${bytes} bytes exceeds the ${maxBytes} byte limit (EC=H)`);
    this.name = 'QRPayloadTooLargeError';
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export type QRGenerationFailure =
  | { code: 'QR_PAYLOAD_TOO_LARGE'; bytes: number; maxBytes: number }
  | { code: 'QR_RENDER_FAILED'; message: string };

export function useQRCode() {
  /**
   * 最近一次渲染失败的原因 —— UI 直接读它决定展示「超出容量」还是「渲染失败」，
   * 不再需要各自 catch 一个空块（原实现把异常吞掉，页面只剩一张空白画布）。
   */
  const failure = ref<QRGenerationFailure | null>(null);

  function clearFailure(): void {
    failure.value = null;
  }

  async function generate(canvas: HTMLCanvasElement, text: string): Promise<void> {
    failure.value = null;

    try {
      await QRCode.toCanvas(canvas, text, {
        width: QR_BITMAP_SIZE,
        margin: 4,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
    } catch (err) {
      // 只有确认超过容量才归因于容量；否则保留原始错误，避免把真正的渲染 bug
      // 误报成「内容太长」。空文本仍由 qrcode 抛 'No input text'（既有契约）。
      const { bytes, overflow } = measureQRPayload(text);
      if (overflow) {
        const capacityError = new QRPayloadTooLargeError(bytes, QR_MAX_PAYLOAD_BYTES);
        failure.value = {
          code: 'QR_PAYLOAD_TOO_LARGE',
          bytes: capacityError.bytes,
          maxBytes: capacityError.maxBytes,
        };
        throw capacityError;
      }

      failure.value = {
        code: 'QR_RENDER_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }

    // qrcode 的 canvas renderer（lib/renderer/canvas.js 的 clearCanvas）每次渲染都会写
    // canvas.style.width/height = '<size>px'。内联样式优先级高于 Tailwind 工具类，
    // 于是画布被锁死在 256px：卡片宽 320px 时左边距 20px、右边距 44px，
    // 卡片本身也变成 320×296 的非正方（视觉上右侧偏宽）。
    // 布局该由 CSS 负责，这里清掉内联尺寸，只保留位图分辨率。
    // 回归测试见 useQRCode.test.ts。
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
  }

  return { generate, failure, clearFailure };
}
