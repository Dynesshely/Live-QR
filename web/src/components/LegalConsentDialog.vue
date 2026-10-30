<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useLocale } from '../composables/useLocale';
import { LEGAL_CONTENT } from '../legal/content';

/**
 * 首次进入的阻断式确认弹窗（三层提示的第二层）。
 *
 * 交互约定：
 * - 打开时焦点落在主按钮上（键盘用户不用先 Tab）；
 * - Esc 只关闭，**不视为同意** —— 同意必须点主按钮；
 * - Tab 在弹窗内循环，不把焦点漏到遮罩后面的页面；
 * - 遮罩点击不关闭：阻断式提示误触关闭等于既没同意也没提示。
 *
 * z-index 50：完整条款弹窗（z-60）要能盖在它上面（从本弹窗点「查看完整条款」时
 * 两个弹窗会同时存在）。
 */
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  agree: [];
  'open-terms': [];
  close: [];
}>();

const { locale } = useLocale();
const copy = computed(() => LEGAL_CONTENT[locale.value]);

const dialogRef = ref<HTMLElement | null>(null);
const primaryRef = ref<HTMLButtonElement | null>(null);

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-3 backdrop-blur-sm sm:p-4"
    >
      <div
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-consent-title"
        aria-describedby="legal-consent-desc"
        class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
      >
        <div class="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
          <h2
            id="legal-consent-title"
            class="text-lg font-semibold text-gray-800 dark:text-gray-100"
          >
            {{ copy.consent.title }}
          </h2>

          <div id="legal-consent-desc" class="mt-2 space-y-2">
            <p
              v-for="(line, index) in copy.consent.body"
              :key="index"
              class="text-sm leading-6 text-gray-600 dark:text-gray-300"
            >
              {{ line }}
            </p>
          </div>

          <ul class="mt-3 space-y-2">
            <li
              v-for="(item, index) in copy.consent.bullets"
              :key="index"
              class="flex gap-2 text-sm leading-6 text-gray-600 dark:text-gray-300"
            >
              <span
                aria-hidden="true"
                class="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
              />
              <span class="min-w-0">{{ item }}</span>
            </li>
          </ul>
        </div>

        <div
          class="shrink-0 border-t border-gray-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-gray-700"
        >
          <div class="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
            <button
              ref="primaryRef"
              type="button"
              class="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] active:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto dark:focus-visible:ring-offset-gray-800"
              @click="emit('agree')"
            >
              {{ copy.consent.agreeLabel }}
            </button>
            <button
              type="button"
              class="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition-all active:scale-[0.98] active:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto dark:border-gray-600 dark:text-gray-300 dark:active:bg-gray-700 dark:focus-visible:ring-offset-gray-800"
              @click="emit('close')"
            >
              {{ copy.consent.laterLabel }}
            </button>
            <button
              type="button"
              class="w-full rounded-xl px-2 py-2 text-center text-xs font-semibold text-blue-600 underline decoration-blue-500/60 underline-offset-2 transition-colors active:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:w-auto sm:mr-auto dark:text-blue-400 dark:active:text-blue-300"
              @click="emit('open-terms')"
            >
              {{ copy.links.viewTerms }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
