<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionStatus } from '../types';
import { useQRCode } from '../composables/useQRCode';

const props = defineProps<{
  text: string | null;
  status: ConnectionStatus;
  reconnectAttempt?: number;
}>();

const { t } = useI18n();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const { generate } = useQRCode();

async function renderQR(text: string): Promise<void> {
  await nextTick();
  if (canvasRef.value) {
    try {
      await generate(canvasRef.value, text);
    } catch {
      // QR generation failed — canvas stays empty
    }
  }
}

// Watch text changes
watch(
  () => props.text,
  async (newText) => {
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
  <div class="relative">
    <!-- QR Code card -->
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 inline-block">
      <!-- Canvas -->
      <template v-if="text">
        <canvas
          ref="canvasRef"
          width="256"
          height="256"
          class="w-full max-w-64 min-w-[200px] aspect-square object-contain"
        ></canvas>
      </template>

      <!-- Placeholder when no data -->
      <div
        v-else
        class="w-full max-w-64 min-w-[200px] aspect-square flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-xl"
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
      class="absolute inset-0 bg-white/70 dark:bg-gray-800/70 rounded-2xl flex items-center justify-center backdrop-blur-sm"
    >
      <div class="text-center">
        <div class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
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
        <svg class="w-10 h-10 mx-auto mb-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-red-600 dark:text-red-400 font-medium">{{ t('viewer.qr.expired') }}</p>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">{{ t('viewer.qr.enterNewCode') }}</p>
      </div>
    </div>

    <!-- Text display below QR -->
    <div v-if="text" class="mt-4 px-1">
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-1">{{ t('viewer.qr.currentText') }}</p>
      <p class="font-mono text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700 rounded-lg p-3 break-all select-all max-h-20 overflow-y-auto">
        {{ text }}
      </p>
    </div>
  </div>
</template>
