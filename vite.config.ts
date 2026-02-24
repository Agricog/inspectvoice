import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'InspectVoice',
        short_name: 'InspectVoice',
        description: 'Voice-driven AI inspection platform for UK parks and playgrounds',
        theme_color: '#0C0F14',
        background_color: '#0C0F14',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // SPA fallback — serves index.html for all navigation requests when offline
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          // Don't intercept API calls or auth redirects
          /^\/api\//,
          /^\/sign-in/,
          /^\/sign-up/,
        ],

        runtimeCaching: [
          // ─── Google Fonts stylesheets ───
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },

          // ─── Google Fonts files (woff2) ───
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ─── API: GET requests (read data — cache as fallback) ───
          // Matches both workers.dev and future custom domain
          {
            urlPattern: ({ url, request }) => {
              const isApi =
                url.hostname.includes('inspectvoice-api') ||
                url.hostname === 'api.inspectvoice.co.uk';
              return isApi && request.method === 'GET';
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },

          // ─── API: mutations (POST/PUT/DELETE — never cache) ───
          {
            urlPattern: ({ url, request }) => {
              const isApi =
                url.hostname.includes('inspectvoice-api') ||
                url.hostname === 'api.inspectvoice.co.uk';
              return isApi && request.method !== 'GET';
            },
            handler: 'NetworkOnly',
          },

          // ─── Clerk auth — always network, never cache tokens ───
          {
            urlPattern: /^https:\/\/.*clerk\..*/i,
            handler: 'NetworkOnly',
          },

          // ─── R2 signed URL uploads — network only ───
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('r2.cloudflarestorage.com') ||
              url.hostname.includes('r2.dev'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@config': fileURLToPath(new URL('./src/config', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
