<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import type { ConnectionStatus } from '../types';
import { useQRCode } from '../composables/useQRCode';

const props = defineProps<{
  text: string | null;
  status: ConnectionStatus;
  reconnectAttempt?: number;
}>();

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
    <div class="bg-white rounded-2xl shadow-lg p-6 inline-block">
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
        class="w-full max-w-64 min-w-[200px] aspect-square flex items-center justify-center bg-gray-100 rounded-xl"
      >
        <div class="text-center text-gray-400">
          <svg class="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M12 4v1m6 11h2m-6 0h-2m0 0H8m4-7V7m0 4h.01M6.5 6.5l.7.7m9.6 9.6l.7.7M4 12h1m14 0h1m-4 6l.7.7M5.8 18.2l.7-.7" />
          </svg>
          <p class="text-sm">等待数据...</p>
        </div>
      </div>
    </div>

    <!-- Reconnecting overlay -->
    <div
      v-if="status === 'reconnecting'"
      class="absolute inset-0 bg-white/70 rounded-2xl flex items-center justify-center backdrop-blur-sm"
    >
      <div class="text-center">
        <div class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        <p class="text-orange-700 font-medium text-sm">
          正在重连...（第 {{ reconnectAttempt ?? 0 }}/5 次）
        </p>
      </div>
    </div>

    <!-- Expired overlay -->
    <div
      v-if="status === 'expired'"
      class="absolute inset-0 bg-white/90 rounded-2xl flex items-center justify-center backdrop-blur-sm"
    >
      <div class="text-center px-4">
        <svg class="w-10 h-10 mx-auto mb-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-red-600 font-medium">该分享码已过期</p>
        <p class="text-gray-500 text-sm mt-1">请重新输入分享码</p>
      </div>
    </div>

    <!-- Text display below QR -->
    <div v-if="text" class="mt-4 px-1">
      <p class="text-xs text-gray-400 mb-1">当前文本内容</p>
      <p class="font-mono text-sm text-gray-700 bg-gray-50 rounded-lg p-3 break-all select-all max-h-20 overflow-y-auto">
        {{ text }}
      </p>
    </div>
  </div>
</template>
