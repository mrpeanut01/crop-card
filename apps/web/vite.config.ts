import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      manifest: {
        name: 'CropCard',
        short_name: 'CropCard',
        description: 'Field-card herbicide planning, planting, and harvest tracking.',
        theme_color: '#1f5e3a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff2,json}'],
        navigateFallback: '/',
        cleanupOutdatedCaches: true,
        // GET /api/plugins is the catalog the kernel + UI need offline.
        // Stale-while-revalidate so the field UI keeps rendering with the
        // last-seen data while a fresh copy fetches in the background.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === '/api/plugins',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cropcard-plugins',
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/sprayers',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cropcard-sprayers',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 24 * 60 * 60 }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/health',
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true
    }
  },
  test: {
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'tests/unit/**/*.{test,spec}.{js,ts}',
      'tests/integration/**/*.{test,spec}.{js,ts}'
    ],
    environment: 'node'
  }
});
