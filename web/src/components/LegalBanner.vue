<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLocale } from '../composables/useLocale';
import { LEGAL_CONTENT } from '../legal/content';

/**
 * 顶部合规提示条（三层提示的第一层）。
 *
 * 刻意作为**文档流里的首块**而不是 fixed / absolute 覆盖：覆盖式提示在
 * 320×568 这类矮屏上会直接压住正文（本项目在主题/语言控件上踩过同样的坑）。
 *
 * 「本次会话内关闭」写 sessionStorage —— 刷新或新开标签页会重新出现，
 * 避免用户误以为关掉提示就等于同意了条款。
 *
 * 关闭按钮用 active: 而不是 hover: 做反馈：Tailwind v4 把 hover: 包进
 * @media (hover: hover)，触屏上不生效。
 */
const SESSION_DISMISS_KEY = 'live-qr-legal-banner-dismissed-v1';

const emit = defineEmits<{
  'open-terms': [];
}>();

const { locale } = useLocale();
const copy = computed(() => LEGAL_CONTENT[locale.value]);

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  } catch {
    // 隐私模式下 sessionStorage 可能抛异常：宁可不记住，也不要让提示消失
    return false;
  }
}

const dismissed = ref(readDismissed());

function dismiss(): void {
  dismissed.value = true;
  try {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
  } catch {
    // 存不进去也只影响「下次是否还显示」，本次已关闭
  }
}
</script>

<template>
  <div v-if="!dismissed" class="w-full shrink-0 pt-[max(0.5rem,env(safe-area-inset-top))]">
    <div class="mx-auto w-full max-w-6xl px-3 sm:px-4">
      <aside
        role="note"
        aria-labelledby="legal-banner-title"
        class="relative flex items-start gap-2.5 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2.5 pr-11 sm:px-4 dark:border-amber-700/70 dark:bg-amber-900/20"
      >
        <svg
          class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>

        <div class="min-w-0 flex-1">
          <p
            id="legal-banner-title"
            class="text-xs font-bold leading-5 text-amber-900 sm:text-sm dark:text-amber-100"
          >
            {{ copy.banner.title }}
          </p>
          <p
            v-for="(line, index) in copy.banner.body"
            :key="index"
            class="mt-0.5 text-xs leading-5 text-amber-800/90 dark:text-amber-200/90"
          >
            {{ line }}
          </p>
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-amber-900 underline decoration-amber-500/70 underline-offset-2 transition-colors active:text-amber-700 dark:text-amber-100 dark:active:text-amber-300"
            @click="emit('open-terms')"
          >
            {{ copy.links.viewTerms }}
            <svg
              class="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        <button
          type="button"
          class="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-amber-700/70 transition-colors active:bg-amber-200/70 dark:text-amber-300/70 dark:active:bg-amber-800/50"
          :aria-label="copy.banner.dismissLabel"
          :title="copy.banner.dismissLabel"
          @click="dismiss"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </aside>
    </div>
  </div>
</template>
