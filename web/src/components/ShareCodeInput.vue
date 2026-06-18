<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const emit = defineEmits<{
  submit: [shareCode: string];
  back: [];
}>();

defineProps<{
  disabled?: boolean;
  error?: string | null;
}>();

const { t } = useI18n();

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

function translateError(err: string): string {
  return err.includes('.') ? t(err) : err;
}
</script>

<template>
  <div class="flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-md">
      <!-- Title -->
      <h1 class="text-4xl font-bold text-center text-gray-800 dark:text-gray-100 mb-2">Live QR</h1>
      <p class="text-center text-gray-500 dark:text-gray-400 mb-8">{{ t('viewer.input.subtitle') }}</p>

      <!-- Input card -->
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <!-- Error banner -->
        <div
          v-if="error"
          class="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm"
        >
          {{ translateError(error) }}
        </div>

        <!-- Input -->
        <label class="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-4">
          {{ t('viewer.input.label') }}
        </label>
        <input
          v-model="inputValue"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="8"
          autocomplete="off"
          :disabled="disabled"
          class="w-full text-center text-3xl tracking-[0.3em] font-mono py-4 px-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          placeholder="00000000"
          @keyup.enter="handleSubmit"
        />

        <!-- Submit button -->
        <button
          :disabled="!isCodeComplete() || disabled"
          class="w-full mt-6 py-3 rounded-xl font-semibold text-white transition-all
                 bg-blue-600 hover:bg-blue-700 active:scale-[0.98]
                 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed disabled:active:scale-100"
          @click="handleSubmit"
        >
          {{ t('viewer.input.submit') }}
        </button>

        <!-- Back button -->
        <button
          class="mt-3 w-fit py-2.5 px-5 rounded-xl font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-[0.98] inline-flex items-center gap-1.5"
          @click="emit('back')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          {{ t('common.back') }}
        </button>
      </div>

      <!-- Hint -->
      <p class="text-center text-gray-400 dark:text-gray-500 text-sm mt-6">
        {{ t('viewer.input.hint') }}
      </p>
    </div>
  </div>
</template>
