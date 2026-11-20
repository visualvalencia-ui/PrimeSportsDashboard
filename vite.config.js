import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z]\.basemaps\.cartocdn\.com\/dark_all\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-dark-tiles',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 14,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Prime Sports Dashboard',
        short_name: 'PrimeDash',
        description: 'Retorno al Prime Deportivo',
        lang: 'es',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/leaflet')) {
            return 'vendor-leaflet';
          }
          if (
            id.includes('node_modules/firebase') ||
            id.includes('node_modules/@firebase')
          ) {
            return 'vendor-firebase';
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
        },
      },
    },
  },
});
