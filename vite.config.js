import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite config for multi-page app (MPA)
 * Supports GitHub Pages deployment with relative base paths
 */
export default defineConfig(({ command }) => {
  // Use relative base for production builds (works on any static host including GitHub Pages subfolders)
  // Use root base for dev server
  const base = command === 'build' ? './' : '/';

  // Multi-page entry points
  const input = {
    // Root
    'index': resolve(__dirname, 'index.html'),

    // Game module
    'game-day': resolve(__dirname, 'game/game-day.html'),
    'game-primary': resolve(__dirname, 'game/game-primary.html'),
    'game-coverage': resolve(__dirname, 'game/game-coverage.html'),
    'game-db': resolve(__dirname, 'game/game-db.html'),
    'game-dl': resolve(__dirname, 'game/game-dl.html'),
    'game-lb': resolve(__dirname, 'game/game-lb.html'),
    'game-lineup': resolve(__dirname, 'game/game-lineup.html'),
    'game-ol': resolve(__dirname, 'game/game-ol.html'),
    'game-penalties': resolve(__dirname, 'game/game-penalties.html'),
    'game-qb': resolve(__dirname, 'game/game-qb.html'),
    'game-rb': resolve(__dirname, 'game/game-rb.html'),
    'game-st': resolve(__dirname, 'game/game-st.html'),
    'game-wr': resolve(__dirname, 'game/game-wr.html'),

    // Tryout module
    'tryout-index': resolve(__dirname, 'tryout/index.html'),
    'tryout-agility': resolve(__dirname, 'tryout/agility.html'),
    'tryout-1v1': resolve(__dirname, 'tryout/tryout-1v1.html'),
    'tryout-db': resolve(__dirname, 'tryout/tryout-db.html'),
    'tryout-dl': resolve(__dirname, 'tryout/tryout-dl.html'),
    'tryout-lb': resolve(__dirname, 'tryout/tryout-lb.html'),
    'tryout-ol': resolve(__dirname, 'tryout/tryout-ol.html'),
    'tryout-qb': resolve(__dirname, 'tryout/tryout-qb.html'),
    'tryout-rb': resolve(__dirname, 'tryout/tryout-rb.html'),
    'tryout-report': resolve(__dirname, 'tryout/tryout-report.html'),
    'tryout-roster': resolve(__dirname, 'tryout/tryout-roster.html'),
    'tryout-team': resolve(__dirname, 'tryout/tryout-team.html'),
    'tryout-wr': resolve(__dirname, 'tryout/tryout-wr.html'),

    // Practice module
    'practice': resolve(__dirname, 'practice/practice.html'),
    'practice-1v1': resolve(__dirname, 'practice/practice-1v1.html'),
    'practice-attendance': resolve(__dirname, 'practice/practice-attendance.html'),
    'practice-cond': resolve(__dirname, 'practice/practice-cond.html'),
    'practice-db': resolve(__dirname, 'practice/practice-db.html'),
    'practice-dl': resolve(__dirname, 'practice/practice-dl.html'),
    'practice-lb': resolve(__dirname, 'practice/practice-lb.html'),
    'practice-ol': resolve(__dirname, 'practice/practice-ol.html'),
    'practice-qb': resolve(__dirname, 'practice/practice-qb.html'),
    'practice-rb': resolve(__dirname, 'practice/practice-rb.html'),
    'practice-st': resolve(__dirname, 'practice/practice-st.html'),
    'practice-team': resolve(__dirname, 'practice/practice-team.html'),
    'practice-wr': resolve(__dirname, 'practice/practice-wr.html'),

    // Wellness module
    'wellness': resolve(__dirname, 'wellness/wellness.html'),
    'wellness-daily': resolve(__dirname, 'wellness/wellness-daily.html'),

    // Forms (schema-driven)
    'forms-game-form': resolve(__dirname, 'forms/pages/game-form.html')
  };

  return {
    base,

    // Build configuration for MPA
    build: {
      outDir: 'dist',
      rollupOptions: {
        input,
        output: {
          // Ensure consistent chunk naming
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.');
            const ext = info[info.length - 1];
            if (/\.(css)$/i.test(assetInfo.name)) {
              return 'assets/css/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      }
    },

    // Dev server configuration
    server: {
      port: 3000,
      open: true,
      // Ensure proper MIME types for JS modules
      fs: {
        strict: false
      }
    },

    // Preview server (for testing production build locally)
    preview: {
      port: 4173,
      open: true
    },

    // Resolve aliases for cleaner imports
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@js': resolve(__dirname, 'js'),
        '@forms': resolve(__dirname, 'forms')
      }
    },

    // Optimize dependencies
    optimizeDeps: {
      // No external deps to optimize (vanilla JS)
    }
  };
});
