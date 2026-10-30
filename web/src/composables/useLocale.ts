import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePreferencesStore } from '@/stores/preferences';
import { SUPPORTED_LOCALES, isLocale, toHtmlLang, type Locale } from '@/i18n';

const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'EN',
  ja: '日本語',
};

export function useLocale() {
  const i18n = useI18n();
  const store = usePreferencesStore();

  const availableLocales: Locale[] = [...SUPPORTED_LOCALES];

  function applyLocale(locale: Locale): void {
    i18n.locale.value = locale;
    document.documentElement.lang = toHtmlLang(locale);
  }

  function setLocale(locale: Locale): void {
    if (!isLocale(locale)) return;
    // 只有用户显式选择才写回持久化偏好
    store.locale = locale;
    applyLocale(locale);
  }

  const currentLabel = computed(() => LOCALE_LABELS[i18n.locale.value as Locale] ?? 'EN');

  function cycleLocale(): void {
    const idx = availableLocales.indexOf(i18n.locale.value as Locale);
    const next = availableLocales[(idx + 1) % availableLocales.length];
    setLocale(next);
  }

  // 初始化顺序：持久化偏好优先；否则保留 i18n.ts 已按 navigator.language 探测的结果。
  // 关键点：**不要**把探测结果写回 store —— 写回等于把「用户没选过」变成「用户选了英文」，
  // 首访就会恒为 en（原实现的 bug，HANDOFF-AUDIT §4.6）。
  if (isLocale(store.locale)) {
    applyLocale(store.locale);
  } else {
    applyLocale(i18n.locale.value as Locale);
  }

  // React to external store changes
  watch(
    () => store.locale,
    (newLocale) => {
      if (isLocale(newLocale) && newLocale !== i18n.locale.value) {
        applyLocale(newLocale);
      }
    },
  );

  return {
    locale: computed(() => i18n.locale.value as Locale),
    setLocale,
    cycleLocale,
    currentLabel,
    availableLocales,
    localeLabels: LOCALE_LABELS,
  };
}
