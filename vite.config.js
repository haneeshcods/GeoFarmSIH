import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Geo-Farm — Vite configuration
// SIH26131: Early detection & management of crop diseases and pest infestations
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    open: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600, // TensorFlow.js + MobileNet weights are large
    rollupOptions: {
      output: {
        manualChunks: {
          tfjs: ['@tensorflow/tfjs', '@tensorflow-models/mobilenet'],
          leaflet: ['leaflet', 'react-leaflet', 'leaflet.heat'],
          charts: ['recharts'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@tensorflow/tfjs', '@tensorflow-models/mobilenet'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
