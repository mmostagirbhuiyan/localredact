/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: {
          'transformers': ['@huggingface/transformers'],
          'pdf': ['pdfjs-dist', 'pdf-lib'],
        },
      },
    },
  },
  plugins: [react()],
  base: '/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
