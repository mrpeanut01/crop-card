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
        theme_color: '#2c5237',
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
          },
          // Phase 13b: cache satellite + street tiles so the Layout map
          // works offline after first load. 30-day cache window.
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'esri-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
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
  resolve: {
    // Resolve Svelte to its browser/client build during tests so
    // @testing-library/svelte's mount() works. Without 'browser' in the
    // conditions, Vite picks Svelte's server export (only render(), no
    // mount()) and component tests fail with `lifecycle_function_unavailable`.
    // The runtime SvelteKit server build still resolves SSR via its own
    // build pipeline, so this only affects the vitest run.
    conditions: process.env.VITEST ? ['browser'] : []
  },
  test: {
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'src/**/*.svelte.{test,spec}.{js,ts}',
      'tests/unit/**/*.{test,spec}.{js,ts}',
      'tests/integration/**/*.{test,spec}.{js,ts}'
    ],
    // jsdom default so component tests get window/document. Pure-logic
    // tests work in jsdom too (~50ms startup tax per file).
    environment: 'jsdom',
    setupFiles: ['./tests/vitestSetup.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    server: {
      deps: {
        // Force Svelte to be inlined so Vite (not Node) resolves it,
        // honoring the `conditions: ['browser']` setting above.
        inline: ['svelte', /^@testing-library\//]
      }
    }
  }
});
