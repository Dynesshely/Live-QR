/**
 * Live-QR brand mark —— 单一几何定义，生成全部图标产物。
 *
 * 为什么是脚本而不是手写 SVG：
 *   icon 需要同时以 SVG（浏览器 favicon，任意缩放）与 PNG（iOS apple-touch-icon
 *   不支持 SVG favicon）两种形态存在。手写会让同一图形散落在 4~5 个文件里，
 *   改一次要同步一片。这里把几何定义收敛到 ICON 一处，其余产物全部由它生成。
 *
 * 用法：pnpm icon          （= node scripts/render-icon.mjs）
 * 环境不需要任何外部依赖：PNG 编码用 node:zlib 手写，光栅化用解析式 SDF + 超采样。
 * 这也顺带解决了本机没有任何 SVG 光栅化器（rsvg-convert / inkscape / cairosvg）的问题。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const REPO = resolve(WEB, '..');

// ── 几何（全部以 64×64 设计栅格为单位）────────────────────────────────

const ICON = {
  grid: 64,

  /** 底板：超椭圆圆角方，左上→右下线性渐变 */
  bg: { radius: 14, from: '#3B82F6', to: '#1D4ED8' },

  /**
   * 三个 QR 定位图案（左上 / 右上 / 左下）。
   * 真实 QR 的定位图案是 7 模块见方、环形 1 模块、中心 3 模块；
   * 16px favicon 下 1 模块 ≈ 0.5px 会糊掉，故环厚加大到 4 单位（14~16px 下 ≈1px），
   * 保证最小尺寸仍然读得出「QR」。
   */
  finder: {
    centers: [
      [18, 18],
      [46, 18],
      [18, 46],
    ],
    // 定位图案取「方环」（外环 + 中空），刻意不做 外环/留白/中心块 的三段式。
    // 三段式在 ≥128px 很好看，但本图标实际只用在 16~80px：留白仅 1~2 单位
    // （16px 下 0.25px），会连同中心块一起糊成发亮的白团（实测 16px 就是这个结果）。
    // 方环则 4:8 的比例在 16px 仍有 1px 环 + 2px 孔，从 16px 到 512px 都成立。
    outerHalf: 8, // 外沿半边长 → 16×16
    ringWidth: 4, // 环厚
    outerRadius: 5.5, // 外圆角
    dotHalf: 0, // 0 = 不画中心块（三段式已弃用）
    dotRadius: 0,
  },

  /**
   * 「实时」信号：右下象限的广播形（同心弧 + 实心点），
   * 这是与普通 QR 图标区分开的唯一元素，用品牌绿。
   */
  live: {
    cx: 46,
    cy: 46,
    dot: 3.4,
    // 单环 + 实心点。双环在 16~32px 会并成一坨绿饼（试过），
    // 一环则从 16px 的「绿点带晕」到 512px 的「信标」都成立。
    rings: [{ r: 7.6, w: 3.2, opacity: 0.85 }],
  },
};

// ── 解析式 SDF：所有图元都可对任意点求「是否在形状内」 ────────────────

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 圆角矩形的有符号距离场（标准 sdRoundBox） */
function sdRoundBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 按 t∈[0,1] 在 from→to 之间取色（不预乘，稍后与覆盖率一起合成） */
function gradientAt(t) {
  const a = hexToRgb(ICON.bg.from);
  const b = hexToRgb(ICON.bg.to);
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * clamp01(t));
}

const GREEN = hexToRgb('#22C55E');

/**
 * 求某点在图标内的着色。
 * 返回 [r, g, b, a]（未预乘）；完全在形状外则 a = 0。
 * 顺序即绘制顺序：底板 → 定位图案 → 实时信号。
 */
function shade(px, py, { rounded }) {
  const G = ICON.grid;
  const bgR = rounded ? ICON.bg.radius : 0;

  // 底板（渐变，t 沿对角线）
  if (sdRoundBox(px, py, G / 2, G / 2, G / 2, G / 2, bgR) <= 0) {
    const [r, g, b] = gradientAt((px + py) / (2 * G));
    let out = [r, g, b, 1];

    // 定位图案：环 + 中心块（白色），中间留缝
    const f = ICON.finder;
    const clHalf = f.outerHalf - f.ringWidth / 2; // 中心线半边长（描边沿中心线展开）
    const clRadius = f.outerRadius - f.ringWidth / 2;
    for (const [cx, cy] of f.centers) {
      const sdRing = sdRoundBox(px, py, cx, cy, clHalf, clHalf, clRadius);
      const inCenterDot =
        f.dotHalf > 0 &&
        sdRoundBox(px, py, cx, cy, f.dotHalf, f.dotHalf, f.dotRadius) <= 0;
      if (Math.abs(sdRing) <= f.ringWidth / 2 || inCenterDot) out = [255, 255, 255, 1];
    }

    // 实时信号：实心点 + 同心弧（绿）
    const L = ICON.live;
    const dx = px - L.cx;
    const dy = py - L.cy;
    const len = Math.hypot(dx, dy);

    if (len <= L.dot) {
      out = [...GREEN, 1];
    } else {
      let alpha = 0;
      for (const ring of L.rings) {
        if (Math.abs(len - ring.r) <= ring.w / 2) alpha = Math.max(alpha, ring.opacity);
      }
      // 环不重叠，取最大不透明度即可；逐环叠加会让相交处发暗
      if (alpha > 0) out = [...GREEN, alpha];
    }
    return out;
  }
  return [0, 0, 0, 0];
}

// ── 光栅化：SS×SS 超采样求覆盖率，得到抗锯齿边缘 ──────────────────────

function render(size, { rounded = true, ss = 4 } = {}) {
  const G = ICON.grid;
  const px = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 在该像素的 SS×SS 子样本上累加（预乘），得到抗锯齿后的像素色
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const gx = ((x + (sx + 0.5) / ss) / size) * G;
          const gy = ((y + (sy + 0.5) / ss) / size) * G;
          const [r, g, b, a] = shade(gx, gy, { rounded });
          ar += r * a;
          ag += g * a;
          ab += b * a;
          aa += a;
        }
      }
      const n = ss * ss;
      const alpha = aa / n;
      const i = (y * size + x) * 4;
      if (alpha > 0) {
        px[i] = Math.round(ar / aa);
        px[i + 1] = Math.round(ag / aa);
        px[i + 2] = Math.round(ab / aa);
      }
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/** 最近邻放大，仅用于人工检视小尺寸图标是否还可辨认 */
function upscale(px, size, factor) {
  const out = Buffer.alloc(size * factor * size * factor * 4);
  for (let y = 0; y < size * factor; y++) {
    for (let x = 0; x < size * factor; x++) {
      const s = ((Math.floor(y / factor) * size) + Math.floor(x / factor)) * 4;
      const d = (y * size * factor + x) * 4;
      px.copy(out, d, s, s + 4);
    }
  }
  return { px: out, size: size * factor };
}

// ── PNG 编码（node:zlib + 手写 CRC32，无第三方依赖）────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression / filter / interlace = 0

  // 每行前置一个 filter 字节 0（None）
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── SVG 输出（与光栅化共用同一份几何）────────────────────────────────

function svgIcon({ rounded = true } = {}) {
  const f = ICON.finder;
  const L = ICON.live;
  const bgR = rounded ? ICON.bg.radius : 0;

  const clHalf = f.outerHalf - f.ringWidth / 2;
  const clRadius = f.outerRadius - f.ringWidth / 2;

  // 定位图案的环：描边沿中心线展开，外沿 16 / 内沿 8，与中心块之间留缝
  const rings = f.centers
    .map(
      ([cx, cy]) =>
        `    <rect x="${cx - clHalf}" y="${cy - clHalf}" width="${clHalf * 2}" height="${
          clHalf * 2
        }" rx="${clRadius}" fill="none" stroke="#fff" stroke-width="${f.ringWidth}"/>`,
    )
    .join('\n');

  const dots =
    f.dotHalf > 0
      ? f.centers
          .map(
            ([cx, cy]) =>
              `    <rect x="${cx - f.dotHalf}" y="${cy - f.dotHalf}" width="${
                f.dotHalf * 2
              }" height="${f.dotHalf * 2}" rx="${f.dotRadius}" fill="#fff"/>`,
          )
          .join('\n')
      : '';

  const arcs = L.rings
    .map(
      (a) =>
        `    <circle cx="${L.cx}" cy="${L.cy}" r="${a.r}" fill="none" stroke="#22C55E" stroke-width="${a.w}" opacity="${a.opacity}"/>`,
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Live QR">
  <title>Live QR</title>
  <defs>
    <linearGradient id="lq-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${ICON.bg.from}"/>
      <stop offset="1" stop-color="${ICON.bg.to}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="${bgR}" fill="url(#lq-bg)"/>
  <g>
${rings}
${dots}
  </g>
  <g>
    <circle cx="${L.cx}" cy="${L.cy}" r="${L.dot}" fill="#22C55E"/>
${arcs}
  </g>
</svg>
`;
}

// ── 产物清单 ─────────────────────────────────────────────────────────

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  console.log(`  ${path.replace(REPO + '/', '')}  ${size} B`);
}

function main() {
  const preview = process.argv.includes('--preview');
  console.log('brand mark:');

  // SVG：浏览器 favicon（可任意缩放，含矢量渐变）
  const svg = svgIcon({ rounded: true });
  write(resolve(REPO, 'assets/logo.svg'), svg);
  write(resolve(WEB, 'public/favicon.svg'), svg);

  // PNG：iOS 不认 SVG favicon，apple-touch-icon 必须是 PNG 且自带外框
  // （iOS 会自己加圆角蒙版，故此处用 full-bleed 直角底板，避免圆角被二次裁切）
  write(resolve(WEB, 'public/favicon-32.png'), encodePng(render(32, { rounded: true, ss: 4 }), 32));
  write(
    resolve(WEB, 'public/apple-touch-icon.png'),
    encodePng(render(180, { rounded: false, ss: 4 }), 180),
  );

  if (preview) {
    // 仅用于人工检视：大图看构图，16/32px 最近邻放大看小尺寸是否还认得出
    const big = render(256, { rounded: true, ss: 3 });
    writeFileSync('/tmp/icon-256.png', encodePng(big, 256));
    for (const s of [16, 32]) {
      const up = upscale(render(s, { rounded: true, ss: 4 }), s, 256 / s);
      writeFileSync(`/tmp/icon-${s}-zoomed.png`, encodePng(up.px, up.size));
    }
    console.log('  previews: /tmp/icon-256.png  /tmp/icon-16-zoomed.png  /tmp/icon-32-zoomed.png');
  }
}

main();
