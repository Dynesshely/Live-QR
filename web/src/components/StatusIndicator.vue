<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionStatus } from '../types';

const props = defineProps<{
  status: ConnectionStatus;
  reconnectAttempt?: number;
  viewerCount?: number;
}>();

const { t } = useI18n();

const labels = computed<Record<ConnectionStatus, string>>(() => ({
  unconnected: t('viewer.status.unconnected'),
  verifying: t('viewer.status.verifying'),
  waiting_data: t('viewer.status.waitingData'),
  connected: t('viewer.status.connected'),
  reconnecting: t('viewer.status.reconnecting', { attempt: props.reconnectAttempt ?? 0, max: 5 }),
  expired: t('viewer.status.expired'),
}));

const viewerCountText = computed(() =>
  props.viewerCount !== undefined
    ? t('viewer.status.viewerCount', { count: props.viewerCount })
    : '',
);
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- Status dot + label -->
    <span
      v-if="status === 'unconnected'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
    >
      <span class="w-2 h-2 rounded-full bg-gray-400"></span>
      {{ labels.unconnected }}
    </span>

    <span
      v-else-if="status === 'verifying'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
    >
      <span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
      {{ labels.verifying }}
    </span>

    <span
      v-else-if="status === 'waiting_data'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
    >
      <span class="w-2 h-2 rounded-full bg-blue-500"></span>
      {{ labels.waiting_data }}
    </span>

    <span
      v-else-if="status === 'connected'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
    >
      <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
      {{ labels.connected }}
      <span v-if="viewerCount !== undefined" class="ml-1 opacity-75">
        {{ viewerCountText }}
      </span>
    </span>

    <span
      v-else-if="status === 'reconnecting'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
    >
      <span class="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
      {{ labels.reconnecting }}
    </span>

    <span
      v-else-if="status === 'expired'"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
    >
      <span class="w-2 h-2 rounded-full bg-red-500"></span>
      {{ labels.expired }}
    </span>
  </div>
</template>
