import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import ShareCodeInput from './ShareCodeInput.vue';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import ja from '../locales/ja.json';

function makeI18n(locale: 'en' | 'zh' | 'ja' = 'zh') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, zh, ja } });
}

function mountInput(props: Record<string, unknown> = {}) {
  return mount(ShareCodeInput, {
    props,
    global: { plugins: [makeI18n()] },
  });
}

describe('ShareCodeInput', () => {
  it('renders the brand name from brand.ts instead of a hardcoded string', () => {
    const wrapper = mountInput();
    expect(wrapper.find('h1').text()).toBe('Live QR');
  });

  it('prefills the last submitted code so failures do not clear user input', () => {
    const wrapper = mountInput({ initialCode: '12345678' });
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('12345678');
  });

  it('shows a localized error message (not a raw i18n key)', () => {
    const wrapper = mountInput({ error: 'serverErrors.TEXT_TOO_LONG' });
    expect(wrapper.text()).toContain(zh.serverErrors.TEXT_TOO_LONG);
  });

  it('shows a loading label on the submit button while verifying', () => {
    const wrapper = mountInput({ initialCode: '12345678', loading: true, disabled: true });

    expect(wrapper.text()).toContain(zh.viewer.input.verifying);
    expect(wrapper.find('button.w-full').attributes('disabled')).toBeDefined();
  });

  it('emits the share code only when all 8 digits are present', async () => {
    const wrapper = mountInput();
    const input = wrapper.find('input');
    const submit = wrapper.find('button.w-full');

    await input.setValue('1234');
    expect(submit.attributes('disabled')).toBeDefined();

    await input.setValue('1234abcd5678');
    expect((input.element as HTMLInputElement).value).toBe('12345678');

    await submit.trigger('click');
    expect(wrapper.emitted('submit')).toEqual([['12345678']]);
  });
});
