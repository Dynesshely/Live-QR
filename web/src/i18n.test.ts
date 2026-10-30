import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectLocale, toHtmlLang, isLocale } from './i18n';

function setNavigatorLanguage(language: string, languages: string[] = [language]): void {
  Object.defineProperty(window.navigator, 'language', {
    value: language,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
}

describe('i18n locale detection', () => {
  it('syncs <html lang> at module load (first paint), not only after mounting', () => {
    // i18n.ts 在 createI18n 之前就把 <html lang> 写成探测结果；
    // 否则首屏会一直是 index.html 里写死的 lang="en"。
    const detected = detectLocale();
    expect(document.documentElement.lang).toBe(toHtmlLang(detected));
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('prefers an explicit persisted preference over the browser language', () => {
    localStorage.setItem('app-preferences', JSON.stringify({ locale: 'ja' }));
    setNavigatorLanguage('en-US');

    expect(detectLocale()).toBe('ja');
  });

  it('ignores an invalid persisted locale and falls back to the browser language', () => {
    localStorage.setItem('app-preferences', JSON.stringify({ locale: 'fr' }));
    setNavigatorLanguage('zh-CN');

    expect(detectLocale()).toBe('zh');
  });

  it('detects zh/ja/en from navigator.language on first visit', () => {
    localStorage.setItem('app-preferences', JSON.stringify({}));

    setNavigatorLanguage('zh-Hans-CN');
    expect(detectLocale()).toBe('zh');

    setNavigatorLanguage('ja-JP');
    expect(detectLocale()).toBe('ja');

    setNavigatorLanguage('en-GB');
    expect(detectLocale()).toBe('en');
  });

  it('tolerates corrupt localStorage', () => {
    localStorage.setItem('app-preferences', '{not json');
    setNavigatorLanguage('ja-JP');

    expect(detectLocale()).toBe('ja');
  });

  it('maps locales to <html lang> values', () => {
    expect(toHtmlLang('zh')).toBe('zh-CN');
    expect(toHtmlLang('ja')).toBe('ja-JP');
    expect(toHtmlLang('en')).toBe('en');
  });

  it('rejects unsupported locale identifiers', () => {
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
