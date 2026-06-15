<script setup lang="ts">
import type { HistoryMessage } from '../types';

defineProps<{
  messages: HistoryMessage[];
}>();

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>

<template>
  <div class="bg-white rounded-2xl shadow-lg p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-800">历史文本</h2>
      <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
        {{ messages.length }} 条
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="messages.length === 0"
      class="text-center py-8 text-gray-400 text-sm"
    >
      暂无数据
    </div>

    <!-- Message list (time-descending) -->
    <div
      v-else
      class="space-y-2 max-h-[500px] overflow-y-auto scrollbar-thin"
    >
      <div
        v-for="(msg, idx) in messages"
        :key="msg.timestamp + '-' + idx"
        class="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span class="text-xs text-gray-400 block mb-1">
          {{ formatTime(msg.timestamp) }}
        </span>
        <p class="text-sm text-gray-700 font-mono break-all">
          {{ msg.data }}
        </p>
      </div>
    </div>
  </div>
</template>
