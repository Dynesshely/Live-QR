<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useLocale } from '../composables/useLocale';
import { LEGAL_CONTENT } from '../legal/content';
import type { LegalSection } from '../legal/content';

/**
 * 完整条款弹窗（三层提示的第三层，也由 Banner / 首确认弹窗的「查看完整条款」打开）。
 *
 * 布局：外层 fixed 遮罩 → 内层 flex column（标题栏 / 可滚动正文 / 固定按钮）。
 * 只有正文滚动，标题与「我已阅读」始终可见；高度用 dvh，避开 iOS 地址栏收放；
 * 底部留 safe-area，iPhone 的 Home 指示条不会盖住按钮。
 *
 * Esc 与右上角 ×、底部「我已阅读」都只关闭，不改变已记录的状态。
 * z-index 60：可能叠在首确认弹窗（z-50）之上。
 */
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { locale } = useLocale();
const copy = computed(() => LEGAL_CONTENT[locale.value]);

const dialogRef = ref<HTMLElement | null>(null);
const primaryRef = ref<HTMLButtonElement | null>(null);

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function paragraphsOf(section: LegalSection): string[] {
  return section.paragraphs ?? [];
}

function bulletsOf(section: LegalSection): string[] {
  return section.bullets ?? [];
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }

  if (event.key !== 'Tab') return;

  const root = dialogRef.value;
  if (!root) return;

  const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);

  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof window === 'undefined') return;
    if (open) {
      window.addEventListener('keydown', onKeydown);
      await nextTick();
      primaryRef.value?.focus();
      return;
    }
    window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
  }
});
</script>

<template>
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 p-2 backdrop-blur-sm sm:p-4"
    >
      <div
        id="terms"
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-terms-title"
        class="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] dark:bg-gray-800"
      >
        <header
          class="shrink-0 border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 dark:border-gray-700"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2
                id="legal-terms-title"
                class="text-base font-semibold text-gray-800 sm:text-lg dark:text-gray-100"
              >
                {{ copy.terms.title }}
              </h2>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ copy.terms.updatedAt }}
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg p-2 text-gray-500 transition-colors active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:active:bg-gray-700"
              :aria-label="copy.terms.closeLabel"
              :title="copy.terms.closeLabel"
              @click="emit('close')"
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
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <section
            v-for="(section, index) in copy.terms.sections"
            :key="index"
            class="mt-5 first:mt-0"
          >
            <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {{ section.heading }}
            </h3>
            <p
              v-for="(paragraph, pIndex) in paragraphsOf(section)"
              :key="pIndex"
              class="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300"
            >
              {{ paragraph }}
            </p>
            <ul v-if="bulletsOf(section).length > 0" class="mt-2 space-y-1.5">
              <li
                v-for="(bullet, bIndex) in bulletsOf(section)"
                :key="bIndex"
                class="flex gap-2 text-sm leading-6 text-gray-600 dark:text-gray-300"
              >
                <span
                  aria-hidden="true"
                  class="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500"
                />
                <span class="min-w-0">{{ bullet }}</span>
              </li>
            </ul>
          </section>
        </div>

        <footer
          class="shrink-0 border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-gray-700"
        >
          <button
            ref="primaryRef"
            type="button"
            class="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] active:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
            @click="emit('close')"
          >
            {{ copy.terms.acknowledgeLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>
