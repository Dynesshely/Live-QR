<script setup lang="ts">
import type { ConnectionStatus } from '../types';

defineProps<{
  status: ConnectionStatus;
  reconnectAttempt?: number;
  viewerCount?: number;
}>();
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Status dot + label -->
    <span
      v-if="status === 'unconnected'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-600"
    >
      <span class="w-2 h-2 rounded-full bg-gray-400"></span>
      未连接
    </span>

    <span
      v-else-if="status === 'verifying'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-yellow-100 text-yellow-700"
    >
      <span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
      正在验证...
    </span>

    <span
      v-else-if="status === 'waiting_data'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-700"
    >
      <span class="w-2 h-2 rounded-full bg-blue-500"></span>
      等待数据...
    </span>

    <span
      v-else-if="status === 'connected'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-green-100 text-green-700"
    >
      <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
      已连接
      <span v-if="viewerCount !== undefined" class="ml-1 opacity-75">
        ({{ viewerCount }} 观看者)
      </span>
    </span>

    <span
      v-else-if="status === 'reconnecting'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-orange-100 text-orange-700"
    >
      <span class="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
      连接断开，正在重连...（第 {{ reconnectAttempt ?? 0 }}/5 次）
    </span>

    <span
      v-else-if="status === 'expired'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-red-100 text-red-600"
    >
      <span class="w-2 h-2 rounded-full bg-red-500"></span>
      通道已过期
    </span>
  </div>
</template>
