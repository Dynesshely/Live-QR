<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWebSocket } from './composables/useWebSocket';
import { useTheme } from './composables/useTheme';
import { useLocale } from './composables/useLocale';
import ShareCodeInput from './components/ShareCodeInput.vue';
import QRDisplay from './components/QRDisplay.vue';
import HistoryList from './components/HistoryList.vue';
import StatusIndicator from './components/StatusIndicator.vue';
import ScannerView from './components/ScannerView.vue';
import FooterBar from './components/FooterBar.vue';
import BrandMark from './components/BrandMark.vue';
import LegalBanner from './components/LegalBanner.vue';
import LegalConsentDialog from './components/LegalConsentDialog.vue';
import LegalTermsDialog from './components/LegalTermsDialog.vue';
import { useLegal } from './composables/useLegal';
import { APP_NAME } from './brand';
import type { ViewerErrorKind } from './types';

type AppMode = 'home' | 'scanner' | 'viewer';

const { t } = useI18n();
const { isDark, toggleTheme } = useTheme();
const { locale, setLocale, availableLocales, localeLabels } = useLocale();

const mode = ref<AppMode>('home');

// ── 合规提示（三层：顶部 Banner / 首次确认 / 完整条款）──
// 状态是模块级单例：Banner、两个弹窗与 App 共享同一份，不做 props 之外的同步。
const {
  termsOpen,
  consentOpen,
  openTerms,
  closeTerms,
  dismissConsent,
  maybePromptConsent,
  agree: agreeLegal,
} = useLegal();

onMounted(() => {
  // 没有持久化同意记录才弹；隐私模式下 localStorage 不可用则每次进入都弹（刻意的降级）
  maybePromptConsent();
});

/** 最近一次提交的分享码：验证失败回到输入页时回填，用户不用重敲 8 位数字 */
const submittedCode = ref('');

// ── Viewer state ──

const {
  status: viewerStatus,
  latestText,
  messages,
  viewerCount,
  reconnectAttempt,
  shareCode,
  errorMessage,
  errorKind: viewerErrorKind,
  sessionStarted,
  connect,
  disconnect,
} = useWebSocket();

function handleConnect(code: string): void {
  submittedCode.value = code;
  connect(code);
}

function handleViewerDisconnect(): void {
  disconnect();
  mode.value = 'home';
}

function handleSwitchCode(): void {
  // Disconnect WS and go back to share code input (stay in viewer mode)
  // 用户明确要换码：清掉回填值，让输入框空出来
  submittedCode.value = '';
  disconnect();
}

function handleScannerBack(): void {
  mode.value = 'home';
}

/**
 * 只有「验证通过并进入会话」之后才切到仪表盘：
 * - verifying 留在输入页（按钮 loading），否则会先闪一下仪表盘再退回；
 * - 验证阶段就失败（分享码错 / 429 / 网络）时 sessionStarted 仍是 false，
 *   同样留在输入页，把错误显示在输入框上方。
 */
const showViewerDashboard = () => {
  return (
    sessionStarted.value &&
    viewerStatus.value !== 'unconnected' &&
    viewerStatus.value !== 'verifying'
  );
};

/**
 * 过期横幅的标题按原因区分：「人满」和「通道过期」是两件完全不同的事，
 * 不能共用同一句话（HANDOFF-AUDIT §4.12 / 任务第 5 条）。
 */
const BANNER_TITLE_KEYS: Partial<Record<ViewerErrorKind, string>> = {
  invalid_code: 'viewer.banner.invalid_code',
  room_full: 'viewer.banner.room_full',
  verify_failed: 'viewer.banner.verify_failed',
};

const bannerTitle = computed(() => {
  const key = BANNER_TITLE_KEYS[viewerErrorKind.value] ?? 'viewer.banner.expired';
  return t(key);
});

function translateError(err: string): string {
  return err.includes('.') ? t(err) : err;
}
</script>

<template>
  <!-- ── Home: mode selection ── -->
  <div v-if="mode === 'home'" class="min-h-dvh bg-gray-50 dark:bg-gray-900 flex flex-col px-4">
    <!-- 合规提示（第一层）：文档流首块，不覆盖内容；关闭仅本会话有效 -->
    <LegalBanner @open-terms="openTerms" />

    <!--
      Theme + Language controls.
      原先用 absolute top-4 right-4 悬浮，在 320×568 这类矮屏上会直接压在居中的
      Logo/标题上（实测重叠）。改为占据文档流的独立一行，任何高度都不再重叠。
    -->
    <div
      class="flex justify-end items-center gap-2 shrink-0 pt-[max(1rem,env(safe-area-inset-top))]"
    >
      <!-- Language select：移动端 font-size ≥16px，否则 iOS 聚焦时会放大整页 -->
      <select
        :value="locale"
        class="appearance-none text-base lg:text-sm font-medium pl-3 pr-8 py-2 rounded-xl bg-white dark:bg-gray-800 shadow-md hover:shadow-lg transition-all text-gray-600 dark:text-gray-300 cursor-pointer border-0 outline-none focus:ring-2 focus:ring-blue-500"
        @change="setLocale(($event.target as HTMLSelectElement).value as 'zh' | 'en' | 'ja')"
      >
        <option v-for="loc in availableLocales" :key="loc" :value="loc">
          {{ localeLabels[loc] }}
        </option>
      </select>

      <!-- Theme toggle -->
      <button
        class="p-2.5 rounded-xl bg-white dark:bg-gray-800 shadow-md hover:shadow-lg transition-all text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white active:scale-95"
        :title="isDark ? t('theme.switchToLight') : t('theme.switchToDark')"
        @click="toggleTheme"
      >
        <!-- Sun icon -->
        <svg v-if="isDark" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        <!-- Moon icon -->
        <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </button>
    </div>

    <!-- Main content: centered vertically -->
    <div class="flex-1 flex flex-col items-center justify-center py-6 sm:py-10">
      <div class="text-center mb-8 sm:mb-10">
        <!-- Logo -->
        <div class="mb-4 sm:mb-6 flex justify-center">
          <BrandMark :size="80" pulse />
        </div>
        <h1 class="text-4xl sm:text-5xl font-bold text-gray-800 dark:text-gray-100 mb-3">
          {{ APP_NAME }}
        </h1>
        <p class="text-base sm:text-lg text-gray-500 dark:text-gray-400">
          {{ t('home.subtitle') }}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 w-full max-w-lg">
        <!-- Scanner mode -->
        <button
          class="group relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/50 p-6 sm:p-8 hover:shadow-xl transition-all hover:-translate-y-1 active:scale-[0.98]"
          @click="mode = 'scanner'"
        >
          <div
            class="w-14 h-14 sm:w-16 sm:h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors"
          >
            <svg
              class="w-7 h-7 sm:w-8 sm:h-8 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
            {{ t('home.scanner.title') }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ t('home.scanner.description') }}
          </p>
        </button>

        <!-- Viewer mode -->
        <button
          class="group relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg dark:shadow-gray-900/50 p-6 sm:p-8 hover:shadow-xl transition-all hover:-translate-y-1 active:scale-[0.98]"
          @click="mode = 'viewer'"
        >
          <div
            class="w-14 h-14 sm:w-16 sm:h-16 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors"
          >
            <svg
              class="w-7 h-7 sm:w-8 sm:h-8 text-blue-600 dark:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">
            {{ t('home.viewer.title') }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('home.viewer.description') }}</p>
        </button>
      </div>
    </div>

    <FooterBar @open-terms="openTerms" />
  </div>

  <!-- ── Scanner mode ── -->
  <ScannerView v-if="mode === 'scanner'" @back="handleScannerBack" />

  <!-- ── Viewer mode: input ── -->
  <template v-if="mode === 'viewer' && !showViewerDashboard()">
    <!-- 顶部 safe-area：避免刘海/灵动岛把输入卡片顶到状态栏下面 -->
    <div class="min-h-dvh flex flex-col pt-[max(0.75rem,env(safe-area-inset-top))]">
      <LegalBanner @open-terms="openTerms" />
      <div class="flex-1 flex items-center justify-center pb-6">
        <ShareCodeInput
          :disabled="viewerStatus === 'verifying'"
          :loading="viewerStatus === 'verifying'"
          :error="errorMessage"
          :initial-code="submittedCode"
          @submit="handleConnect"
          @back="mode = 'home'"
        />
      </div>
      <FooterBar @open-terms="openTerms" />
    </div>
  </template>

  <!-- ── Viewer mode: dashboard ── -->
  <template v-if="mode === 'viewer' && showViewerDashboard()">
    <div class="min-h-dvh bg-gray-50 dark:bg-gray-900 flex flex-col">
      <LegalBanner @open-terms="openTerms" />
      <!-- Header bar -->
      <header
        class="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700"
      >
        <div
          class="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <!-- Top row: nav controls (compact on all screens) -->
          <div class="flex items-center justify-between">
            <!-- min-w-0 + truncate：窄屏（320px）下让品牌名先被截断，而不是把右侧控件挤出屏幕 -->
            <div class="flex items-center gap-1 sm:gap-3 min-w-0">
              <!-- Back icon (no text) -->
              <button
                class="p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 active:scale-95"
                :title="t('common.home')"
                @click="handleViewerDisconnect"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>

              <!-- Logo + project name：图标刻意小于字号视觉尺度，避免头重脚轻 -->
              <BrandMark :size="24" />
              <span
                class="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100 truncate"
              >
                {{ APP_NAME }}
              </span>
            </div>

            <div class="flex items-center gap-1 sm:gap-2">
              <!-- Switch code (icon only) -->
              <button
                class="p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 active:scale-95"
                :title="t('viewer.switchCode')"
                @click="handleSwitchCode"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </button>

              <!-- Language switcher -->
              <select
                :value="locale"
                class="appearance-none text-base lg:text-sm font-medium pl-1.5 pr-6 py-2.5 rounded-lg bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300 cursor-pointer border-0 outline-none focus:ring-2 focus:ring-blue-500"
                @change="
                  setLocale(($event.target as HTMLSelectElement).value as 'zh' | 'en' | 'ja')
                "
              >
                <option v-for="loc in availableLocales" :key="loc" :value="loc">
                  {{ localeLabels[loc] }}
                </option>
              </select>

              <!-- Theme toggle -->
              <button
                class="p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300 active:scale-95"
                :title="isDark ? t('theme.switchToLight') : t('theme.switchToDark')"
                @click="toggleTheme"
              >
                <svg
                  v-if="isDark"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- Bottom row: share code + status (moved out of nav) -->
          <!-- flex-wrap：窄屏下分享码与状态胶囊宁可换行，也不要把彼此挤变形 -->
          <div class="flex flex-wrap items-center justify-between mt-2 gap-x-2 gap-y-1.5">
            <span
              v-if="shareCode"
              class="font-mono text-base sm:text-lg tracking-wider bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2.5 sm:px-3 py-0.5 rounded-lg"
            >
              {{ shareCode }}
            </span>
            <div v-else></div>
            <StatusIndicator
              :status="viewerStatus"
              :reconnect-attempt="reconnectAttempt"
              :viewer-count="viewerCount"
            />
          </div>
        </div>
      </header>

      <!-- Expired banner -->
      <div v-if="viewerStatus === 'expired'" class="max-w-6xl w-full mx-auto mt-4 px-3 sm:px-4">
        <div
          class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div class="min-w-0 flex-1">
            <p class="text-red-700 dark:text-red-400 font-medium">
              {{ bannerTitle }}
            </p>
            <p class="text-red-500 dark:text-red-400/80 text-sm">
              {{ errorMessage ? translateError(errorMessage) : '' }}
            </p>
          </div>
          <button
            class="px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors shrink-0 active:scale-95"
            @click="handleSwitchCode"
          >
            {{ t('viewer.reenterCode') }}
          </button>
        </div>
      </div>

      <!-- Main content -->
      <main class="flex-1 max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-8 w-full">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
          <div class="flex flex-col items-center lg:items-start">
            <QRDisplay
              :text="latestText"
              :status="viewerStatus"
              :reconnect-attempt="reconnectAttempt"
            />
          </div>
          <div class="w-full min-w-0">
            <HistoryList :messages="messages" />
          </div>
        </div>
      </main>

      <FooterBar @open-terms="openTerms" />
    </div>
  </template>

  <!-- 合规弹窗（第二/三层）：置于最后，DOM 顺序 + z-index 保证条款弹窗叠在首确认之上 -->
  <LegalConsentDialog
    :open="consentOpen"
    @agree="agreeLegal"
    @open-terms="openTerms"
    @close="dismissConsent"
  />
  <LegalTermsDialog :open="termsOpen" @close="closeTerms" />
</template>
