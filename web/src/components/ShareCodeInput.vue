<script setup lang="ts">
import { ref, watch } from 'vue';

const emit = defineEmits<{
  submit: [shareCode: string];
}>();

defineProps<{
  disabled?: boolean;
  error?: string | null;
}>();

const inputValue = ref('');

// Only allow digits, max 8
watch(inputValue, (val) => {
  inputValue.value = val.replace(/\D/g, '').slice(0, 8);
});

const isCodeComplete = () => inputValue.value.length === 8;

function handleSubmit(): void {
  if (!isCodeComplete()) return;
  emit('submit', inputValue.value);
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen px-4">
    <div class="w-full max-w-md">
      <!-- Title -->
      <h1 class="text-4xl font-bold text-center text-gray-800 mb-2">QR-Live</h1>
      <p class="text-center text-gray-500 mb-8">实时二维码展示系统</p>

      <!-- Input card -->
      <div class="bg-white rounded-2xl shadow-lg p-8">
        <!-- Error banner -->
        <div
          v-if="error"
          class="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          {{ error }}
        </div>

        <!-- Input -->
        <label class="block text-sm font-medium text-gray-600 mb-2">
          输入 8 位分享码
        </label>
        <input
          v-model="inputValue"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="8"
          autocomplete="off"
          :disabled="disabled"
          class="w-full text-center text-3xl tracking-[0.3em] font-mono py-4 px-4 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder="00000000"
          @keyup.enter="handleSubmit"
        />

        <!-- Submit button -->
        <button
          :disabled="!isCodeComplete() || disabled"
          class="w-full mt-6 py-3 rounded-xl font-semibold text-white transition-all
                 bg-blue-600 hover:bg-blue-700 active:scale-[0.98]
                 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:active:scale-100"
          @click="handleSubmit"
        >
          开始展示
        </button>
      </div>

      <!-- Hint -->
      <p class="text-center text-gray-400 text-sm mt-6">
        请向 App 用户索取 8 位分享码
      </p>
    </div>
  </div>
</template>
