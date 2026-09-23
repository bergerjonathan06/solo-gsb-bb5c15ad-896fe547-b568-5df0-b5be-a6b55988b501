import { defineConfig } from 'vite';

// 纯前端静态构建；生产环境由 server/main.mjs（零依赖 Node 静态服务器）托管
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
