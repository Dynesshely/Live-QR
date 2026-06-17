<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { HistoryMessage } from '../types';

defineProps<{
  messages: HistoryMessage[];
}>();

const { t, locale } = useI18n();

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>

<template>
  <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">{{ t('viewer.history.title') }}</h2>
      <span class="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
        {{ t('viewer.history.count', { count: messages.length }) }}
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="messages.length === 0"
      class="text-center py-8 text-gray-400 dark:text-gray-500 text-sm"
    >
      {{ t('viewer.history.empty') }}
    </div>

    <!-- Message list (time-descending) -->
    <div
      v-else
      class="space-y-2 max-h-[500px] overflow-y-auto scrollbar-thin"
    >
      <div
        v-for="(msg, idx) in messages"
        :key="msg.timestamp + '-' + idx"
        class="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <span class="text-xs text-gray-400 dark:text-gray-500 block mb-1">
          {{ formatTime(msg.timestamp) }}
        </span>
        <p class="text-sm text-gray-700 dark:text-gray-200 font-mono break-all">
          {{ msg.data }}
        </p>
      </div>
    </div>
  </div>
</template>
