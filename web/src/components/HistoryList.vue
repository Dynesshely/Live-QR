<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQRCode } from '../composables/useQRCode';
import type { HistoryMessage } from '../types';

defineProps<{
  messages: HistoryMessage[];
}>();

const { t, locale } = useI18n();
const { generate } = useQRCode();

const modalText = ref<string | null>(null);
const modalCanvasRef = ref<HTMLCanvasElement | null>(null);

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function openQRModal(text: string): Promise<void> {
  modalText.value = text;
  await nextTick();
  if (modalCanvasRef.value) {
    try {
      await generate(modalCanvasRef.value, text);
    } catch {
      // QR generation failed
    }
  }
}

function closeQRModal(): void {
  modalText.value = null;
}
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 sm:p-6">
    <div class="flex items-center justify-between mb-3 sm:mb-4">
      <h2 class="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100">
        {{ t('viewer.history.title') }}
      </h2>
      <span
        class="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full shrink-0"
      >
        {{ t('viewer.history.count', { count: messages.length }) }}
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="messages.length === 0"
      class="text-center py-8 text-gray-400 dark:text-gray-500 text-sm"
    >
      {{ t('viewer.history.empty') }}
    </div>

    <!-- Message list (time-descending) -->
    <!-- 移动端按可视高度收敛，避免列表把整页拉得过长 -->
    <div v-else class="space-y-2 max-h-[50dvh] sm:max-h-125 overflow-y-auto scrollbar-thin">
      <div
        v-for="(msg, idx) in messages"
        :key="msg.timestamp + '-' + idx"
        class="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 transition-colors flex items-start gap-2"
      >
        <div class="flex-1 min-w-0">
          <span class="text-xs text-gray-400 dark:text-gray-500 block mb-1">
            {{ formatTime(msg.timestamp) }}
          </span>
          <p class="text-sm text-gray-700 dark:text-gray-200 font-mono break-all">
            {{ msg.data }}
          </p>
        </div>
        <!-- QR button：p-2.5 让触控目标接近 40px（原 p-1.5 仅 28px，手机上易点偏） -->
        <button
          class="shrink-0 p-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 active:scale-95 transition-colors"
          :title="t('viewer.history.showQR')"
          :aria-label="t('viewer.history.showQR')"
          @click="openQRModal(msg.data)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="4.5" y="4.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="15.5" y="4.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" stroke-width="1.5" />
            <rect x="4.5" y="15.5" width="4" height="4" rx="0.5" stroke-width="1" />
            <rect x="15" y="15" width="4" height="4" rx="1.5" stroke-width="1.5" />
            <path d="M15 15l4 4" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- QR Modal -->
  <Teleport to="body">
    <div
      v-if="modalText"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      @click.self="closeQRModal"
    >
      <!-- max-h + overflow：横屏/矮屏下 256px 画布加文字会超出视口 -->
      <div
        class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm max-h-[85dvh] overflow-y-auto"
      >
        <div class="flex items-center justify-between mb-4 gap-2">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate flex-1">
            {{ modalText }}
          </h3>
          <button
            class="p-2.5 -mr-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:scale-95"
            :aria-label="t('common.close')"
            @click="closeQRModal"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div class="flex justify-center">
          <canvas
            ref="modalCanvasRef"
            width="256"
            height="256"
            class="block w-full h-auto max-w-64 aspect-square rounded-xl"
          ></canvas>
        </div>
        <p class="text-center text-xs text-gray-400 dark:text-gray-500 mt-4 break-all select-all">
          {{ modalText }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
