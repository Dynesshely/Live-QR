<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionStatus } from '../types';
import { useQRCode, QR_BITMAP_SIZE } from '../composables/useQRCode';

const props = defineProps<{
  text: string | null;
  status: ConnectionStatus;
  reconnectAttempt?: number;
}>();

const { t } = useI18n();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const { generate, failure, clearFailure } = useQRCode();

const failureTitle = computed(() =>
  failure.value?.code === 'QR_PAYLOAD_TOO_LARGE'
    ? t('viewer.qr.tooLongTitle')
    : t('viewer.qr.renderFailed'),
);

const failureDetail = computed(() =>
  failure.value?.code === 'QR_PAYLOAD_TOO_LARGE'
    ? t('viewer.qr.tooLongDetail', {
        bytes: failure.value.bytes,
        max: failure.value.maxBytes,
      })
    : '',
);

async function renderQR(text: string): Promise<void> {
  await nextTick();
  const canvas = canvasRef.value;
  if (!canvas) return;

  try {
    await generate(canvas, text);
  } catch {
    // 失败原因由 failure 暴露（容量超限 / 渲染失败），模板据此显示提示；
    // 原文始终保留在下方，可复制 —— 不再出现「卡片空白且没有任何解释」。
  }
}

// Watch text changes
watch(
  () => props.text,
  async (newText) => {
    clearFailure();
    if (newText) {
      await renderQR(newText);
    }
  },
);

onMounted(async () => {
  if (props.text) {
    await renderQR(props.text);
  }
});
</script>

<template>
  <!--
    原先卡片是 inline-block + canvas 固定 max-w-64/min-w-50，尺寸完全由内容决定：
    320px 屏下卡片实宽 304px，直接把页面左右各 16px 的内边距吃光（只剩 8px 白边），
    更窄的机型就会溢出。改为一层 w-full max-w-80 的流体容器 + 内部 w-full 画布，
    画布宽度由可用宽度决定，320px 起都能正确留白。
  -->
  <div class="relative w-full max-w-80">
    <!-- QR Code card -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 sm:p-5">
      <!-- Canvas -->
      <template v-if="text">
        <!--
          初始 width/height 直接等于位图分辨率（QR_BITMAP_SIZE），
          不再先按 256 画一帧再被 qrcode 改成 1024。
          canvas 始终保留在 DOM 中（失败时用 hidden 隐藏），否则渲染失败后
          ref 为空，后续重试拿不到 canvas。
        -->
        <canvas
          v-show="!failure"
          ref="canvasRef"
          :width="QR_BITMAP_SIZE"
          :height="QR_BITMAP_SIZE"
          class="block w-full h-auto aspect-square rounded-xl"
        ></canvas>

        <!-- 容量超限 / 渲染失败：给出明确原因，而不是留一张空白画布 -->
        <div
          v-if="failure"
          class="w-full aspect-square flex items-center justify-center bg-red-50 dark:bg-red-900/20 rounded-xl px-4 text-center"
        >
          <div>
            <svg
              class="w-10 h-10 mx-auto mb-2 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p class="text-sm font-medium text-red-700 dark:text-red-400">{{ failureTitle }}</p>
            <p v-if="failureDetail" class="text-xs text-red-500 dark:text-red-400/80 mt-1">
              {{ failureDetail }}
            </p>
          </div>
        </div>
      </template>

      <!-- Placeholder when no data -->
      <div
        v-else
        class="w-full aspect-square flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-xl"
      >
        <div class="text-center text-gray-400 dark:text-gray-500">
          <svg class="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="4.5" y="4.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="15.5" y="4.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="4.5" y="15.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="15" y="15" width="4" height="4" rx="1.5" stroke-width="1.5" />
            <path d="M15 15l4 4" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <p class="text-sm">{{ t('viewer.qr.waiting') }}</p>
        </div>
      </div>
    </div>

    <!-- Reconnecting overlay -->
    <div
      v-if="status === 'reconnecting'"
      class="absolute inset-0 bg-white/70 dark:bg-gray-800/70 rounded-2xl flex items-center justify-center backdrop-blur-sm p-4"
    >
      <div class="text-center">
        <div
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"
        ></div>
        <p class="text-orange-700 dark:text-orange-400 font-medium text-sm">
          {{ t('viewer.qr.reconnecting', { attempt: reconnectAttempt ?? 0, max: 5 }) }}
        </p>
      </div>
    </div>

    <!-- Expired overlay -->
    <div
      v-if="status === 'expired'"
      class="absolute inset-0 bg-white/90 dark:bg-gray-800/90 rounded-2xl flex items-center justify-center backdrop-blur-sm"
    >
      <div class="text-center px-4">
        <svg
          class="w-10 h-10 mx-auto mb-2 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p class="text-red-600 dark:text-red-400 font-medium">{{ t('viewer.qr.expired') }}</p>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {{ t('viewer.qr.enterNewCode') }}
        </p>
      </div>
    </div>

    <!-- Text display below QR -->
    <div v-if="text" class="mt-3 sm:mt-4 px-1">
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-1">{{ t('viewer.qr.currentText') }}</p>
      <p
        class="font-mono text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 break-all select-all max-h-20 overflow-y-auto"
      >
        {{ text }}
      </p>
    </div>
  </div>
</template>
