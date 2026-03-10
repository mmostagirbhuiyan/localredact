import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: {
          'transformers': ['@xenova/transformers'],
          'pdf': ['pdfjs-dist', 'pdf-lib'],
        },
      },
    },
  },
  plugins: [react()],
  base: '/',
});
