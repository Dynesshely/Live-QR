<script setup lang="ts">
import { APP_NAME } from '../brand';

/**
 * 品牌图标。
 *
 * 图形唯一来源是 `web/public/favicon.svg`（由 `pnpm icon` 从
 * scripts/render-icon.mjs 的同一份几何定义生成），这里只做 `<img>` 引用 ——
 * 之前 favicon.svg / assets/logo.svg / App.vue 里两份内联 SVG 各自维护同一图形，
 * 改一次要同步四处，必然漂移。
 */
withDefaults(
  defineProps<{
    /** 边长（px） */
    size?: number;
    /** 首页 hero 用：叠一圈绿色呼吸光晕，呼应「实时」 */
    pulse?: boolean;
    label?: string;
  }>(),
  { size: 32, pulse: false, label: APP_NAME },
);
</script>

<template>
  <span class="relative inline-flex shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
    <span v-if="pulse" class="brand-pulse" aria-hidden="true" />
    <img src="/favicon.svg" :alt="label" width="64" height="64" class="relative w-full h-full" />
  </span>
</template>

<style scoped>
.brand-pulse {
  position: absolute;
  inset: 0;
  border-radius: 24%;
  background: #22c55e;
  animation: brand-pulse 2s ease-out infinite;
}

@keyframes brand-pulse {
  0% {
    transform: scale(0.92);
    opacity: 0.3;
  }
  70%,
  100% {
    transform: scale(1.22);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brand-pulse {
    animation: none;
    opacity: 0;
  }
}
</style>
