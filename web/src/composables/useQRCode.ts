import QRCode from 'qrcode';

export function useQRCode() {
  async function generate(canvas: HTMLCanvasElement, text: string): Promise<void> {
    await QRCode.toCanvas(canvas, text, {
      width: 256,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }

  return { generate };
}
