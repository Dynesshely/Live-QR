/* eslint-disable */
import en from '../locales/en.json';

/**
 * en.json 是消息结构的唯一事实来源。
 *
 * 为什么这里不能宣称「t() 的键在编译期会被检查」：
 * vue-i18n v11 的 `useI18n()` / `createI18n()` 默认泛型是
 * `DefaultLocaleMessageSchema`，只有显式写 `useI18n<{ message: typeof en }>()`
 * 才会真正约束键名 —— 那需要改动所有组件（10+ 处调用点），并且运行时拼出来的
 * 错误键（服务端错误码 → i18n 键）本来就不是字面量，强类型会逼着到处 cast。
 *
 * 所以这里的取舍是：
 * - 保留由 en.json 推导的真实 schema（比 `Record<string, any>` 信息量更大，
 *   后续想精确约束时可直接 `useI18n<{ message: MessageSchema }>()`）；
 * - 键集合的回归保护交给单测 `src/locales/locales.test.ts`
 *   （三语键集合一致 + 无空串 + 命名占位符一致），这是当前更可靠的兜底。
 */
type MessageSchema = typeof en;

declare module 'vue-i18n' {
  interface DefineLocaleMessage extends MessageSchema {}
}

export {};
