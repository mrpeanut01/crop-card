import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import type { VitePWAOptions } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TenantCachePlugin } from './src/lib/client/swTenantKey.ts';

// Import-free TS modules compiled into classic scripts the generated SW
// loads via `importScripts` (see workbox.importScripts below).
const SW_MODULES = [
  {
    source: fileURLToPath(new URL('./src/lib/client/swTenantKey.ts', import.meta.url)),
    fileName: 'sw-tenant.js',
    globalName: '__cropcardSwTenantLib',
    install:
      'self.__cropcardTenantPlugin = __cropcardSwTenantLib.installSwTenant(self, (b) => new Response(b));'
  },
  {
    source: fileURLToPath(new URL('./src/lib/client/swPush.ts', import.meta.url)),
    fileName: 'sw-push.js',
    globalName: '__cropcardSwPushLib',
    install: '__cropcardSwPushLib.installSwPush(self);'
  }
];

function cropcardSwModules(): Plugin {
  let ssr = false;
  return {
    name: 'cropcard:sw-modules',
    apply: 'build',
    configResolved(config) {
      ssr = !!config.build.ssr;
    },
    async generateBundle() {
      if (ssr) return;
      for (const mod of SW_MODULES) {
        const source = await readFile(mod.source, 'utf-8');
        const { code } = await transform(source, {
          sourcefile: mod.source,
          loader: 'ts',
          format: 'iife',
          globalName: mod.globalName,
          target: 'es2020',
          minify: true
        });
        this.emitFile({
          type: 'asset',
          fileName: mod.fileName,
          source: `${code}\n${mod.install}\n`
        });
      }
    }
  };
}

// Stringified into the generated SW by workbox-build, so each callback must
// be self-contained. Missing runtime ⇒ fail safe (no cache read or write).
type SwTenantGlobal = { __cropcardTenantPlugin?: TenantCachePlugin };
type RuntimeCachingEntry = NonNullable<
  NonNullable<VitePWAOptions['workbox']>['runtimeCaching']
>[number];
type WorkboxPlugin = NonNullable<NonNullable<RuntimeCachingEntry['options']>['plugins']>[number];
const tenantCachePlugin: WorkboxPlugin = {
  cacheKeyWillBeUsed: async (p) => {
    const t = (globalThis as SwTenantGlobal).__cropcardTenantPlugin;
    return t ? t.cacheKeyWillBeUsed(p) : p.request;
  },
  cachedResponseWillBeUsed: async (p) => {
    const t = (globalThis as SwTenantGlobal).__cropcardTenantPlugin;
    return t ? ((await t.cachedResponseWillBeUsed(p)) as Response | null) : null;
  },
  cacheWillUpdate: async (p) => {
    const t = (globalThis as SwTenantGlobal).__cropcardTenantPlugin;
    return t ? ((await t.cacheWillUpdate(p)) as Response | null) : null;
  },
  fetchDidSucceed: async (p) => {
    const t = (globalThis as SwTenantGlobal).__cropcardTenantPlugin;
    return t ? ((await t.fetchDidSucceed(p)) as Response) : p.response;
  }
};

export default defineConfig({
  plugins: [
    cropcardSwModules(),
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
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        importScripts: ['sw-tenant.js', 'sw-push.js'],
        // Tenant-scoped runtime caches are keyed per active Owner by
        // `tenantCachePlugin` (logic in src/lib/client/swTenantKey.ts), so an
        // Owner switch keeps every farm's entries and never cross-serves.
        // NetworkFirst: online reads always hit the server (which is also how
        // the SW notices a session/Owner change); the cache is the offline
        // fallback. No navigateFallback: SSR pages are not precached, so
        // offline navigations use the per-Owner page cache instead.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === '/api/plugins',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cropcard-tenant-plugins',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
              plugins: [tenantCachePlugin]
            }
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/sprayers',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cropcard-tenant-sprayers',
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 24 * 60 * 60 },
              plugins: [tenantCachePlugin]
            }
          },
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cropcard-tenant-pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
              plugins: [tenantCachePlugin]
            }
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.endsWith('/__data.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cropcard-tenant-data',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              plugins: [tenantCachePlugin]
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
    ...(process.env.VITEST ? { conditions: ['browser'] } : {})
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
