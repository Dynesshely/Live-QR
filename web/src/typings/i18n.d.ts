/* eslint-disable */
import type en from '../locales/en.json';

declare module 'vue-i18n' {
  // Extend the DefineLocaleMessage interface with our message schema
  interface DefineLocaleMessage extends Record<string, any> {}
}

export {};
