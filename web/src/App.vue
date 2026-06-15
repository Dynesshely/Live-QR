<script setup lang="ts">
import { ref } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import ShareCodeInput from './components/ShareCodeInput.vue';
import QRDisplay from './components/QRDisplay.vue';
import HistoryList from './components/HistoryList.vue';
import StatusIndicator from './components/StatusIndicator.vue';
import ScannerView from './components/ScannerView.vue';

type AppMode = 'home' | 'scanner' | 'viewer';

const mode = ref<AppMode>('home');

// ── Viewer state ──

const {
  status: viewerStatus,
  latestText,
  messages,
  viewerCount,
  reconnectAttempt,
  shareCode,
  errorMessage,
  connect,
  disconnect,
} = useWebSocket();

function handleConnect(code: string): void {
  connect(code);
}

function handleViewerDisconnect(): void {
  disconnect();
  mode.value = 'home';
}

function handleScannerBack(): void {
  mode.value = 'home';
}

const showViewerDashboard = () => {
  return viewerStatus.value !== 'unconnected';
};
</script>

<template>
  <!-- ── Home: mode selection ── -->
  <div
    v-if="mode === 'home'"
    class="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4"
  >
    <div class="text-center mb-10">
      <h1 class="text-5xl font-bold text-gray-800 mb-3">QR-Live</h1>
      <p class="text-gray-500 text-lg">实时二维码扫描与展示系统</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-lg">
      <!-- Scanner mode -->
      <button
        class="group relative bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-all hover:-translate-y-1 active:scale-[0.98]"
        @click="mode = 'scanner'"
      >
        <div class="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-green-200 transition-colors">
          <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-gray-800 mb-2">我是上传者</h2>
        <p class="text-sm text-gray-500">打开摄像头扫描二维码并上传</p>
      </button>

      <!-- Viewer mode -->
      <button
        class="group relative bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-all hover:-translate-y-1 active:scale-[0.98]"
        @click="mode = 'viewer'"
      >
        <div class="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-200 transition-colors">
          <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M12 4v1m6 11h2m-6 0h-2m0 0H8m4-7V7m0 4h.01M6.5 6.5l.7.7m9.6 9.6l.7.7M4 12h1m14 0h1m-4 6l.7.7M5.8 18.2l.7-.7" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-gray-800 mb-2">我是观看者</h2>
        <p class="text-sm text-gray-500">输入分享码查看实时二维码</p>
      </button>
    </div>
  </div>

  <!-- ── Scanner mode ── -->
  <ScannerView
    v-if="mode === 'scanner'"
    @back="handleScannerBack"
  />

  <!-- ── Viewer mode: input ── -->
  <template v-if="mode === 'viewer' && !showViewerDashboard()">
    <div class="relative">
      <button
        class="absolute top-4 left-4 z-10 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
        @click="mode = 'home'"
      >
        ← 返回
      </button>
      <ShareCodeInput
        :disabled="viewerStatus === 'verifying'"
        :error="errorMessage"
        @submit="handleConnect"
      />
    </div>
  </template>

  <!-- ── Viewer mode: dashboard ── -->
  <template v-if="mode === 'viewer' && showViewerDashboard()">
    <div class="min-h-screen bg-gray-50">
      <!-- Header bar -->
      <header class="bg-white shadow-sm border-b border-gray-200">
        <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-4">
            <button
              class="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
              @click="handleViewerDisconnect"
            >
              ← 首页
            </button>
            <h1 class="text-xl font-bold text-gray-800">QR-Live</h1>
            <span
              v-if="shareCode"
              class="font-mono text-lg tracking-wider bg-blue-50 text-blue-700 px-3 py-0.5 rounded-lg"
            >
              {{ shareCode }}
            </span>
          </div>

          <div class="flex items-center gap-3">
            <StatusIndicator
              :status="viewerStatus"
              :reconnect-attempt="reconnectAttempt"
              :viewer-count="viewerCount"
            />
            <button
              class="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
              @click="handleViewerDisconnect"
            >
              切换分享码
            </button>
          </div>
        </div>
      </header>

      <!-- Expired banner -->
      <div
        v-if="viewerStatus === 'expired'"
        class="max-w-6xl mx-auto mt-4 px-4"
      >
        <div class="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p class="text-red-700 font-medium">该分享码已过期（30 分钟无上传）</p>
            <p class="text-red-500 text-sm">{{ errorMessage }}</p>
          </div>
          <button
            class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
            @click="handleViewerDisconnect"
          >
            重新输入分享码
          </button>
        </div>
      </div>

      <!-- Main content -->
      <main class="max-w-6xl mx-auto px-4 py-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div class="flex flex-col items-center lg:items-start">
            <QRDisplay
              :text="latestText"
              :status="viewerStatus"
              :reconnect-attempt="reconnectAttempt"
            />
          </div>
          <div>
            <HistoryList :messages="messages" />
          </div>
        </div>
      </main>
    </div>
  </template>
</template>
