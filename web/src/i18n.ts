import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';

export type Locale = 'en' | 'zh' | 'ja';

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh', 'ja'];

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('app-preferences');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.locale && SUPPORTED_LOCALES.includes(parsed.locale)) {
        return parsed.locale as Locale;
      }
    }
  } catch {
    // ignore corrupt localStorage
  }

  const lang = (navigator.language ?? 'en').toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  return 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, zh, ja },
});
