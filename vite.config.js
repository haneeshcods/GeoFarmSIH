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
          three: ['three'],
          // 3D Geospatial Outbreak Engine (Real3DTerrainMap.jsx) — its own
          // chunk so the ~1.5MB maplibre-gl + deck.gl payload is only
          // fetched when an officer/student actually opens the
          // "Photorealistic 3D Terrain" view (dynamic import in
          // GISMap.jsx), never on initial dashboard load.
          'terrain-3d': [
            'maplibre-gl',
            '@deck.gl/core',
            '@deck.gl/layers',
            '@deck.gl/aggregation-layers',
            '@deck.gl/mapbox',
            '@deck.gl/extensions',
          ],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@tensorflow/tfjs', '@tensorflow-models/mobilenet'],
    // AUDIT FIX (build/bundle 5.2): @tensorflow/tfjs-backend-wasm is only
    // ever reached via a runtime `await import(...)` inside
    // utils/tfBackend.js (the WebGL -> WASM fallback path) — it should
    // never be eagerly pre-bundled on cold dev-server start. Letting Vite's
    // dependency scanner pull it into the eager pre-bundle graph anyway
    // was intermittently producing "outdated optimize dep" / dynamic
    // import failures the first time the fallback path actually ran,
    // because the scanner-produced chunk and the lazily-resolved runtime
    // import could disagree after a cache invalidation. Excluding it here
    // forces Vite to always resolve it through the normal dynamic-import
    // pipeline instead.
    exclude: ['@tensorflow/tfjs-backend-wasm'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
