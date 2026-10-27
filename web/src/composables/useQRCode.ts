import QRCode from 'qrcode';

/**
 * 位图分辨率 —— 注意它**不等于**显示尺寸，显示尺寸完全交给 CSS。
 *
 * 取 1024 的理由：卡片宽度上限 320px（QRDisplay 的 max-w-80 减内边距），
 * 画布最大约 280 CSS px；在 DPR 3 的屏幕上需要约 840 物理像素，
 * 1024 足以覆盖而无需放大位图。二维码一旦被插值放大就会发虚，
 * 直接影响对端摄像头能否识别，所以宁可位图大一点让它被缩小显示。
 */
export const QR_BITMAP_SIZE = 1024;

export function useQRCode() {
  async function generate(canvas: HTMLCanvasElement, text: string): Promise<void> {
    await QRCode.toCanvas(canvas, text, {
      width: QR_BITMAP_SIZE,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    // qrcode 的 canvas renderer（lib/renderer/canvas.js 的 clearCanvas）每次渲染都会写
    // canvas.style.width/height = '<size>px'。内联样式优先级高于 Tailwind 工具类，
    // 于是画布被锁死在 256px：卡片宽 320px 时左边距 20px、右边距 44px，
    // 卡片本身也变成 320×296 的非正方（视觉上右侧偏宽）。
    // 布局该由 CSS 负责，这里清掉内联尺寸，只保留位图分辨率。
    // 回归测试见 useQRCode.test.ts。
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
  }

  return { generate };
}
