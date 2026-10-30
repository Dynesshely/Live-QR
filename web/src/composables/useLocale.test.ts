import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import { useLocale } from './useLocale';
import { usePreferencesStore } from '@/stores/preferences';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import ja from '../locales/ja.json';

type LocaleApi = ReturnType<typeof useLocale>;

let localeApi: LocaleApi | null = null;

/** 唯一组件：useLocale 里用了 useI18n()，必须在组件 setup 中调用 */
const Harness = defineComponent({
  setup() {
    localeApi = useLocale();
    return () => h('div');
  },
});

function createTestI18n(locale: 'en' | 'zh' | 'ja') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, zh, ja } });
}

function mountHarness(detectedLocale: 'en' | 'zh' | 'ja') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const i18n = createTestI18n(detectedLocale);

  const wrapper = mount(Harness, { global: { plugins: [pinia, i18n] } });
  return { wrapper, i18n, store: usePreferencesStore() };
}

describe('useLocale', () => {
  beforeEach(() => {
    localeApi = null;
  });

  it('keeps the browser-detected locale when the user never chose one', () => {
    // store 默认值是空串（「没选过」）；原实现默认 'en'，会把 navigator 探测结果覆盖掉
    const { wrapper, i18n, store } = mountHarness('zh');

    expect(store.locale).toBe('');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');

    wrapper.unmount();
  });

  it('does not persist the detected locale as an explicit preference', () => {
    const { wrapper, store } = mountHarness('ja');

    // 探测结果不能写回 store，否则下次访问会被当成用户显式选择
    expect(store.locale).toBe('');
    wrapper.unmount();
  });

  it('applies and persists an explicit user choice, syncing <html lang>', () => {
    const { wrapper, i18n, store } = mountHarness('en');

    localeApi!.setLocale('ja');

    expect(store.locale).toBe('ja');
    expect(i18n.global.locale.value).toBe('ja');
    expect(document.documentElement.lang).toBe('ja-JP');
    expect(localeApi!.locale.value).toBe('ja');

    wrapper.unmount();
  });

  it('ignores unsupported locale identifiers', () => {
    const { wrapper, store } = mountHarness('en');

    localeApi!.setLocale('fr' as never);
    expect(store.locale).toBe('');
    expect(document.documentElement.lang).toBe('en');

    wrapper.unmount();
  });
});
