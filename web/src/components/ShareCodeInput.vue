<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { APP_NAME } from '../brand';

const emit = defineEmits<{
  submit: [shareCode: string];
  back: [];
}>();

const props = defineProps<{
  disabled?: boolean;
  /** 正在验证分享码：按钮显示 loading，输入框禁用，但仍停留在本页 */
  loading?: boolean;
  error?: string | null;
  /**
   * 上一次提交过的分享码。
   * 验证失败（429 / 网络错误 / 分享码错误）后回到输入页时回填，
   * 避免用户重新敲 8 位数字。
   */
  initialCode?: string;
}>();

const { t } = useI18n();

function sanitizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

const inputValue = ref(sanitizeCode(props.initialCode ?? ''));

// 外部回填（组件重建时 initialCode 已就绪；运行中变化时同步）
watch(
  () => props.initialCode,
  (val) => {
    const next = sanitizeCode(val ?? '');
    if (next && next !== inputValue.value) {
      inputValue.value = next;
    }
  },
);

// Only allow digits, max 8
watch(inputValue, (val) => {
  const cleaned = sanitizeCode(val);
  if (cleaned !== val) {
    inputValue.value = cleaned;
  }
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
  <div class="w-full flex flex-col items-center justify-center px-3 sm:px-4">
    <div class="w-full max-w-md">
      <!-- Title：品牌名唯一来源是 brand.ts 的 APP_NAME，不在模板里硬编码 -->
      <h1 class="text-3xl sm:text-4xl font-bold text-center text-gray-800 dark:text-gray-100 mb-2">
        {{ APP_NAME }}
      </h1>
      <p class="text-center text-gray-500 dark:text-gray-400 mb-6 sm:mb-8">
        {{ t('viewer.input.subtitle') }}
      </p>

      <!-- Input card -->
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-5 sm:p-8">
        <!--
          Error banner：验证失败/限流/网络错误都会回到本页，错误就在这里显示
          （错误值是 i18n 键或服务端错误码映射后的键，统一走 translateError）。
        -->
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
        <!-- 字号/字距随宽度收敛：320px 下 8 位数字 + 0.3em 字距会撑出输入框 -->
        <input
          v-model="inputValue"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="8"
          autocomplete="off"
          :disabled="disabled"
          class="w-full text-center text-2xl sm:text-3xl tracking-[0.2em] sm:tracking-[0.3em] font-mono py-4 px-2 sm:px-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          placeholder="00000000"
          @keyup.enter="handleSubmit"
        />

        <!-- Submit button：验证中显示 loading，页面不跳转 -->
        <button
          :disabled="!isCodeComplete() || disabled || loading"
          class="w-full mt-6 py-3.5 rounded-xl font-semibold text-white transition-all
                 bg-blue-600 hover:bg-blue-700 active:scale-[0.98]
                 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed disabled:active:scale-100"
          @click="handleSubmit"
        >
          <span v-if="loading" class="inline-flex items-center justify-center gap-2">
            <span
              class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              aria-hidden="true"
            ></span>
            {{ t('viewer.input.verifying') }}
          </span>
          <span v-else>{{ t('viewer.input.submit') }}</span>
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
      <p class="text-center text-gray-400 dark:text-gray-500 text-sm mt-5 sm:mt-6">
        {{ t('viewer.input.hint') }}
      </p>
    </div>
  </div>
</template>
