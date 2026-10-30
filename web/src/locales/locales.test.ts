import { describe, it, expect } from 'vitest';
import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';

type Flat = Record<string, string>;

/**
 * 把嵌套的 locale 对象压平成 `a.b.c` → 文案。
 * 用于保证三份 locale 的键集合完全一致 —— 之前 `scanner.status.idle` 只在英文里
 * 是空串、新增错误码只补了一种语言，这类漏翻在运行时只会表现为「界面里冒出键名」。
 */
function flatten(value: unknown, prefix = ''): Flat {
  const out: Flat = {};
  if (!value || typeof value !== 'object') return out;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') {
      Object.assign(out, flatten(child, path));
    } else {
      out[path] = String(child);
    }
  }
  return out;
}

const flattened = {
  en: flatten(en),
  zh: flatten(zh),
  ja: flatten(ja),
} as const;

describe('locale catalogs', () => {
  it('en/zh/ja expose exactly the same key set', () => {
    const enKeys = Object.keys(flattened.en).sort();
    const zhKeys = Object.keys(flattened.zh).sort();
    const jaKeys = Object.keys(flattened.ja).sort();

    expect(zhKeys).toEqual(enKeys);
    expect(jaKeys).toEqual(enKeys);
  });

  it('no translation is empty (previously scanner.status.idle was "")', () => {
    for (const [locale, messages] of Object.entries(flattened)) {
      for (const [key, text] of Object.entries(messages)) {
        expect(text.trim(), `${locale}.${key} is empty`).not.toBe('');
      }
    }
  });

  it('every locale provides the scanner idle state and server error messages', () => {
    for (const [locale, messages] of Object.entries(flattened)) {
      expect(messages['scanner.status.idle'], `${locale}.scanner.status.idle`).toBeTruthy();
      expect(messages['serverErrors.TEXT_TOO_LONG'], `${locale}.serverErrors.TEXT_TOO_LONG`).toBeTruthy();
    }
  });

  it('keeps the same named placeholders in every language', () => {
    const placeholderPattern = /\{[^}]+\}/g;

    for (const key of Object.keys(flattened.en)) {
      const expected = (flattened.en[key].match(placeholderPattern) ?? []).sort();
      for (const locale of ['zh', 'ja'] as const) {
        const actual = (flattened[locale][key].match(placeholderPattern) ?? []).sort();
        expect(actual, `${locale}.${key} placeholders differ from en`).toEqual(expected);
      }
    }
  });
});
