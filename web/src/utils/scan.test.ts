import { describe, it, expect } from 'vitest';
import { computeCoverCrop } from './scan';

describe('computeCoverCrop', () => {
  it('falls back to the full frame when any dimension is unknown', () => {
    expect(computeCoverCrop(1280, 720, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
    expect(computeCoverCrop(0, 0, 390, 844)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });

  it('crops the sides when a portrait video is shown in a taller viewport', () => {
    // 视频 720x1280，容器 390x844 → cover 后上下贴满，左右各裁掉约 65px
    expect(computeCoverCrop(720, 1280, 390, 844)).toEqual({ sx: 65, sy: 0, sw: 591, sh: 1280 });
  });

  it('crops the sides of a landscape video shown in a portrait viewport', () => {
    // 1280x720 在 390x844 里 cover：按高度放大，左右各裁掉约 474px
    expect(computeCoverCrop(1280, 720, 390, 844)).toEqual({ sx: 474, sy: 0, sw: 333, sh: 720 });
  });

  it('crops a square video symmetrically', () => {
    expect(computeCoverCrop(720, 720, 390, 844)).toEqual({ sx: 194, sy: 0, sw: 333, sh: 720 });
  });

  it('keeps the whole frame when the container matches the video aspect ratio', () => {
    expect(computeCoverCrop(1280, 720, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });
});
