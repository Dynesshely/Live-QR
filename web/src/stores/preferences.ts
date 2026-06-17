import { defineStore } from 'pinia';

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    locale: 'en' as string,
    theme: 'auto' as 'light' | 'dark' | 'auto',
  }),
  persist: {
    key: 'app-preferences',
  },
});
