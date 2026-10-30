import { defineStore } from 'pinia';

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    /**
     * 空串 = **用户还没选过语言**。
     *
     * 原默认值是 'en'，useLocale 会把它当成显式偏好反写回 i18n，
     * 于是 i18n.ts 里按 navigator.language 的探测永远被覆盖，首访恒为英文。
     * 这里保持空串，探测结果不落盘；用户切一次语言后才写入真实值。
     */
    locale: '' as string,
    theme: 'auto' as 'light' | 'dark' | 'auto',
  }),
  persist: {
    key: 'app-preferences',
  },
});
