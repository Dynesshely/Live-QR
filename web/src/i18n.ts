import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';

export type Locale = 'en' | 'zh' | 'ja';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh', 'ja'];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** i18n locale → `<html lang>` 的值（zh/ja 带地区，便于字体与断行按地区生效） */
export function toHtmlLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en';
}

/**
 * 解析初始语言：持久化偏好 > 浏览器语言 > 英文。
 *
 * 这里必须**同时**读 localStorage：本函数在 createI18n 之前执行，
 * 此时 Pinia 与 persistedstate 还没跑起来（store 是组件 setup 里才实例化的）。
 * 偏好写回 store 只在用户显式切换语言时发生（见 useLocale.setLocale）。
 */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('app-preferences');
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        const storedLocale = (parsed as { locale?: unknown }).locale;
        if (isLocale(storedLocale)) return storedLocale;
      }
    }
  } catch {
    // ignore corrupt localStorage
  }

  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const candidates = [nav?.language, ...(nav?.languages ?? [])];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const lang = candidate.toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('en')) return 'en';
  }

  return 'en';
}

const initialLocale = detectLocale();

/**
 * 首屏同步 `<html lang>`。
 * 本模块在 `main.ts` 里先于 `createApp().mount()` 求值，所以这里赋值是同步的；
 * 否则首屏会一直是 index.html 里写死的 `lang="en"`（HANDOFF-AUDIT §4.6）。
 */
if (typeof document !== 'undefined') {
  document.documentElement.lang = toHtmlLang(initialLocale);
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: { en, zh, ja },
});
