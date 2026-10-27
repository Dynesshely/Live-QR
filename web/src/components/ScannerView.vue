<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useScanner } from '../composables/useScanner';
import BrandMark from './BrandMark.vue';
import { APP_NAME } from '../brand';

const emit = defineEmits<{
  back: [];
}>();

const { t } = useI18n();
const { state, startCamera, start, stop } = useScanner();

const videoRef = ref<HTMLVideoElement | null>(null);
const isStarting = ref(false);

const statusLabel = computed(() => {
  return t(`scanner.status.${state.value.status}`);
});

function translateError(err: string): string {
  if (err.includes('::')) {
    const [key, detail] = err.split('::');
    return t(key, { detail });
  }
  return err.includes('.') ? t(err) : err;
}

async function handleStart(): Promise<void> {
  if (isStarting.value) return;
  isStarting.value = true;

  try {
    if (!videoRef.value) throw new Error('scanner.error.cameraGeneric::无法访问摄像头元素');

    await startCamera(videoRef.value);
    await start();
  } catch (err) {
    state.value.status = 'error';
    state.value.errorMessage = err instanceof Error ? err.message : 'scanner.error.startFailed';
  } finally {
    isStarting.value = false;
  }
}

function handleStop(): void {
  stop();
  emit('back');
}

// Copy share code to clipboard
async function copyShareCode(): Promise<void> {
  if (state.value.shareCode) {
    try {
      await navigator.clipboard.writeText(state.value.shareCode);
    } catch {
      const input = document.createElement('input');
      input.value = state.value.shareCode;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
  }
}

// Auto-start when component mounts
onMounted(() => {
  setTimeout(() => handleStart(), 300);
});
</script>

<template>
  <div class="min-h-dvh bg-gray-900 flex flex-col">
    <!-- Camera area -->
    <div class="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
      <!-- Video preview -->
      <video
        ref="videoRef"
        class="absolute inset-0 w-full h-full object-cover"
        autoplay
        playsinline
        muted
      ></video>

      <!-- Scan frame overlay：固定 w-64 在 320px 屏上几乎顶满，改为按视口宽度收敛 -->
      <div
        v-if="state.status === 'scanning'"
        class="relative z-10 w-[min(70vw,16rem)] aspect-square border-2 border-green-400 rounded-3xl"
      >
        <div
          class="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-xl"
        ></div>
        <div
          class="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-xl"
        ></div>
        <div
          class="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-xl"
        ></div>
        <div
          class="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-xl"
        ></div>
      </div>

      <!--
        悬浮品牌标识（Logo + 项目名）。
        叠在摄像头画面上方，故用半透明底 + 背景模糊保证任意取景内容下都可读；
        pt 用 max() 避开刘海/状态栏。
        blur 用 md（12px）而非 sm（4px）：后者对着单调墙面几乎看不出模糊，
        等于白加。再加一道极淡的内描边，否则在深色画面上"玻璃面"没有边界、
        看起来像是渲染坏了。
      -->
      <div class="absolute top-0 left-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span
          class="inline-flex items-center gap-2 rounded-full bg-black/35 backdrop-blur-md ring-1 ring-white/10 pl-2.5 pr-4 py-1.5"
        >
          <BrandMark :size="26" />
          <span class="text-sm font-semibold text-white leading-none">{{ APP_NAME }}</span>
        </span>
      </div>

      <!-- Auto-rebuilt banner：下移一行，避免与左上角品牌标识重叠 -->
      <div
        v-if="state.showRebuiltBanner"
        class="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-pulse max-w-[90vw] text-center"
      >
        {{ t('scanner.autoRebuilt') }}
      </div>

      <!-- Starting state -->
      <div
        v-if="state.status === 'starting'"
        class="relative z-10 flex flex-col items-center gap-4 text-white"
      >
        <div
          class="animate-spin w-10 h-10 border-3 border-white border-t-transparent rounded-full"
        ></div>
        <p class="text-lg">{{ t('scanner.starting') }}</p>
      </div>

      <!-- Error state -->
      <div
        v-if="state.status === 'error'"
        class="relative z-10 flex flex-col items-center gap-4 text-white px-6 text-center"
      >
        <svg class="w-14 h-14 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p class="text-lg font-medium">{{ t('scanner.error.cameraFailed') }}</p>
        <p class="text-sm text-gray-300">
          {{ state.errorMessage ? translateError(state.errorMessage) : '' }}
        </p>
        <div class="flex gap-3 mt-2">
          <button
            class="px-5 py-2.5 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors text-sm active:scale-95"
            @click="handleStart"
          >
            {{ t('common.retry') }}
          </button>
          <button
            class="px-5 py-2.5 bg-white/10 text-white/70 rounded-lg hover:bg-white/20 transition-colors text-sm active:scale-95"
            @click="handleStop"
          >
            {{ t('common.back') }}
          </button>
        </div>
      </div>
    </div>

    <!--
      Bottom panel.
      pb 用 max(1rem, env(safe-area-inset-bottom))：否则 iPhone 的 Home 指示条会
      压在「停止扫码」按钮上。
    -->
    <div class="bg-gray-800 px-3 sm:px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <!-- Share code display -->
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2 sm:gap-3 min-w-0">
          <span class="text-gray-400 text-sm shrink-0">{{ t('scanner.shareCode') }}</span>
          <span
            class="font-mono text-xl sm:text-2xl tracking-[0.15em] sm:tracking-[0.2em] text-green-400 font-bold"
          >
            {{ state.shareCode || '--------' }}
          </span>
        </div>
        <button
          v-if="state.shareCode"
          class="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg text-xs hover:bg-gray-600 transition-colors active:scale-95"
          @click="copyShareCode"
        >
          {{ t('common.copy') }}
        </button>
      </div>

      <!-- Offline queue indicator -->
      <div
        v-if="state.offlineQueueSize > 0"
        class="mb-3 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-2 flex items-center gap-2"
      >
        <svg
          class="w-4 h-4 text-yellow-400 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span class="text-yellow-300 text-sm">
          {{ t('scanner.offlineQueue', { count: state.offlineQueueSize, max: 6 }) }}
        </span>
      </div>

      <!--
        Status bar：原先是单行 justify-between 三段内容，窄屏上会互相挤压；
        改为可换行（flex-wrap），并让「停止扫码」在需要时独占一行且拉满宽度。
      -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="relative flex h-2.5 w-2.5">
            <span
              v-if="state.status === 'scanning'"
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
            ></span>
            <span
              :class="{
                'bg-green-400': state.status === 'scanning',
                'bg-yellow-400': state.status === 'starting',
                'bg-red-400': state.status === 'error',
              }"
              class="relative inline-flex rounded-full h-2.5 w-2.5"
            ></span>
          </span>
          <span class="text-gray-300">{{ statusLabel }}</span>
        </div>

        <div class="flex items-center gap-3 text-gray-400 min-w-0">
          <span class="shrink-0">{{ t('scanner.uploadCount', { count: state.uploadCount }) }}</span>
          <!-- Upload result feedback -->
          <span v-if="state.lastUploadResult === 'success'" class="text-green-400 text-xs">{{
            t('scanner.upload.success')
          }}</span>
          <span v-else-if="state.lastUploadResult === 'failed'" class="text-red-400 text-xs">{{
            t('scanner.upload.failed', {
              detail: state.lastUploadResultText ? translateError(state.lastUploadResultText) : '',
            })
          }}</span>
          <span
            v-else-if="state.lastUploadResult === 'rate_limited'"
            class="text-yellow-400 text-xs"
            >{{ t('scanner.upload.rateLimited') }}</span
          >
          <span v-if="state.lastScannedText" class="max-w-30 truncate hidden sm:inline">
            "{{ state.lastScannedText }}"
          </span>
        </div>

        <button
          class="ml-auto w-full sm:w-auto px-4 py-2.5 bg-red-600/80 text-white rounded-lg text-sm hover:bg-red-600 transition-colors active:scale-95"
          @click="handleStop"
        >
          {{ t('common.stop') }}
        </button>
      </div>
    </div>
  </div>
</template>
