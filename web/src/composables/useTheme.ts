import { computed, onMounted, onUnmounted } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';

export function useTheme() {
  const store = usePreferencesStore();

  const isDark = computed(() => {
    if (store.theme === 'dark') return true;
    if (store.theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const resolvedTheme = computed<'dark' | 'light'>(() =>
    isDark.value ? 'dark' : 'light',
  );

  function applyThemeClass(): void {
    document.documentElement.classList.toggle('dark', isDark.value);
  }

  function setTheme(theme: 'light' | 'dark' | 'auto'): void {
    store.theme = theme;
    applyThemeClass();
  }

  function toggleTheme(): void {
    const next = store.theme === 'auto'
      ? (isDark.value ? 'light' : 'dark')
      : store.theme === 'dark'
        ? 'light'
        : 'auto';
    setTheme(next);
  }

  let mq: MediaQueryList | null = null;
  onMounted(() => {
    applyThemeClass();
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyThemeClass);
  });
  onUnmounted(() => {
    if (mq) mq.removeEventListener('change', applyThemeClass);
  });

  return {
    isDark,
    resolvedTheme,
    theme: computed(() => store.theme),
    setTheme,
    toggleTheme,
    applyThemeClass,
  };
}
