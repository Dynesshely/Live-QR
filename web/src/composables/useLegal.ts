import { onMounted, onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * 合规提示的交互状态（三层提示里「首次确认弹窗」和「完整条款弹窗」的开关）。
 *
 * 状态放在**模块级单例**而不是每次调用各建一份：Banner、两个弹窗与 App 都可能
 * 调用 useLegal()，共享同一份状态才能让「Banner 里的查看条款」和 App 里的
 * 开关保持一致。
 *
 * 两处持久化：
 * - 同意记录写 localStorage（键 live-qr-legal-consent-v1，值为 ISO 时间）；
 *   隐私模式 / 被策略禁用时 localStorage 会抛异常 —— 此时降级为「每次都提示」，
 *   绝不因为存不进去就当作已经同意。
 * - 完整条款与 #terms 锚点联动：打开时写 hash（可直接分享「先看条款」的链接），
 *   关闭时清掉。用 history.replaceState 而非 location.hash，避免 hashchange
 *   自我循环与历史栈堆积。
 */

/** 条款同意记录的 localStorage 键，值是同意时刻的 ISO 字符串 */
export const LEGAL_CONSENT_STORAGE_KEY = 'live-qr-legal-consent-v1';

/** 打开完整条款时写入地址栏的锚点 */
export const LEGAL_TERMS_HASH = '#terms';

const termsOpen = ref(false);
const consentOpen = ref(false);

/** 正在监听 hashchange 的组件数；减到 0 时摘掉监听 */
let hashConsumers = 0;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** 读取同意记录；localStorage 不可用时返回 null（= 没有记录） */
function readConsentRecord(): string | null {
  if (!hasWindow()) return null;
  try {
    return window.localStorage.getItem(LEGAL_CONSENT_STORAGE_KEY);
  } catch {
    // 隐私模式 / 存储被禁用：当作没有记录，本次会话每次都提示
    return null;
  }
}

/** 没有同意记录（或存储不可用）时返回 true —— 调用方据此决定是否弹首确认 */
export function needsConsent(): boolean {
  const record = readConsentRecord();
  return record === null || record === '';
}

function hashIsTerms(): boolean {
  return hasWindow() && window.location.hash === LEGAL_TERMS_HASH;
}

/** 把地址栏同步到目标状态；失败（文件协议、沙箱）不影响弹窗本身 */
function writeTermsHash(open: boolean): void {
  if (!hasWindow()) return;
  const base = window.location.pathname + window.location.search;
  const target = open ? base + LEGAL_TERMS_HASH : base;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current === target) return;
  try {
    window.history.replaceState(window.history.state, '', target);
  } catch {
    // 仅影响「链接可分享」，弹窗照常工作
  }
}

function syncTermsFromHash(): void {
  termsOpen.value = hashIsTerms();
}

function openTerms(): void {
  termsOpen.value = true;
  writeTermsHash(true);
}

function closeTerms(): void {
  termsOpen.value = false;
  writeTermsHash(false);
}

function openConsent(): void {
  consentOpen.value = true;
}

/** 关闭首确认弹窗但不记录同意（点「稍后」或按 Esc） */
function dismissConsent(): void {
  consentOpen.value = false;
}

/**
 * 首次进入时调用：没有同意记录就打开弹窗。
 * @returns 是否打开了弹窗
 */
function maybePromptConsent(): boolean {
  if (!needsConsent()) return false;
  consentOpen.value = true;
  return true;
}

/**
 * 记录同意（ISO 时间）并关闭弹窗。
 * 写入失败时仍然关闭 —— 本次会话可以继续用，下次打开会再问一次。
 */
function agree(): void {
  if (hasWindow()) {
    try {
      window.localStorage.setItem(LEGAL_CONSENT_STORAGE_KEY, new Date().toISOString());
    } catch {
      // 降级：不持久化，下次进入重新确认
    }
  }
  consentOpen.value = false;
}

export interface LegalState {
  /** 完整条款弹窗是否打开（可写，便于外部按需强制开关） */
  termsOpen: Ref<boolean>;
  /** 首次确认弹窗是否打开（可写） */
  consentOpen: Ref<boolean>;
  openTerms: () => void;
  closeTerms: () => void;
  openConsent: () => void;
  dismissConsent: () => void;
  maybePromptConsent: () => boolean;
  agree: () => void;
  needsConsent: () => boolean;
}

export function useLegal(): LegalState {
  onMounted(() => {
    hashConsumers += 1;
    // 首屏带 #terms 进来时直接打开条款；用户已经通过按钮打开过也保持打开
    syncTermsFromHash();
    if (hashConsumers === 1) {
      window.addEventListener('hashchange', syncTermsFromHash);
    }
  });

  onUnmounted(() => {
    hashConsumers = Math.max(0, hashConsumers - 1);
    if (hashConsumers === 0 && hasWindow()) {
      window.removeEventListener('hashchange', syncTermsFromHash);
    }
  });

  return {
    termsOpen,
    consentOpen,
    openTerms,
    closeTerms,
    openConsent,
    dismissConsent,
    maybePromptConsent,
    agree,
    needsConsent,
  };
}
