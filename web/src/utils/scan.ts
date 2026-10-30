/**
 * 摄像头预览与解码区域的一致性计算（纯函数，便于单测）。
 *
 * 问题：`<video>` 用 `object-cover` 时，容器里看到的只是视频帧的**中心裁切区域**，
 * 而原先的解码用整帧 —— 画面里看不到的二维码可能被解出来，画面里看到的也可能在裁切外。
 *
 * 取舍：保留 object-cover（移动端全屏取景，观感/可用性远好于 object-contain 的
 * 大片黑边），改为把解码源区域按 cover 的裁切规则同步裁切。
 * 这样「所见即所扫」严格成立，取景框只承担对焦引导作用，不构成裁切限制。
 */

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * 计算 object-cover 下实际可见的那块视频区域（单位：视频像素）。
 *
 * 任何一维非正（元素隐藏、元数据未就绪）时退化为整帧，调用方仍能正常解码。
 */
export function computeCoverCrop(
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number,
): CropRect {
  const fullFrame: CropRect = { sx: 0, sy: 0, sw: videoWidth, sh: videoHeight };

  if (videoWidth <= 0 || videoHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
    return fullFrame;
  }

  // object-cover: scale = max(displayW / videoW, displayH / videoH)
  const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
  const visibleWidth = Math.min(videoWidth, displayWidth / scale);
  const visibleHeight = Math.min(videoHeight, displayHeight / scale);

  const sw = Math.max(1, Math.round(visibleWidth));
  const sh = Math.max(1, Math.round(visibleHeight));

  return {
    sx: Math.max(0, Math.round((videoWidth - sw) / 2)),
    sy: Math.max(0, Math.round((videoHeight - sh) / 2)),
    sw,
    sh,
  };
}
