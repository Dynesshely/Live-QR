import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePreferencesStore } from '@/stores/preferences';
import type { Locale } from '@/i18n';

const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'EN',
  ja: '日本語',
};

export function useLocale() {
  const i18n = useI18n();
  const store = usePreferencesStore();

  const availableLocales: Locale[] = ['zh', 'en', 'ja'];

  function setLocale(locale: Locale): void {
    store.locale = locale;
    i18n.locale.value = locale;
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en';
  }

  const currentLabel = computed(() => LOCALE_LABELS[i18n.locale.value as Locale] ?? 'EN');

  function cycleLocale(): void {
    const idx = availableLocales.indexOf(i18n.locale.value as Locale);
    const next = availableLocales[(idx + 1) % availableLocales.length];
    setLocale(next);
  }

  // Sync from store on init
  if (store.locale && availableLocales.includes(store.locale as Locale)) {
    i18n.locale.value = store.locale;
  }

  // React to external store changes
  watch(
    () => store.locale,
    (newLocale) => {
      if (availableLocales.includes(newLocale as Locale)) {
        i18n.locale.value = newLocale;
        document.documentElement.lang = newLocale === 'zh' ? 'zh-CN' : newLocale === 'ja' ? 'ja-JP' : 'en';
      }
    },
  );

  return { locale: computed(() => i18n.locale.value as Locale), setLocale, cycleLocale, currentLabel, availableLocales };
}
