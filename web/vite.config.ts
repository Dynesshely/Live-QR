import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 41605,
    proxy: {
      '/api': 'http://localhost:41601',
      '/ws': {
        target: 'ws://localhost:41602',
        ws: true,
      },
    },
  },
});
