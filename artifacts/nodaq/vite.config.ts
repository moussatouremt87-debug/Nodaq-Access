import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// FRONTEND_PORT takes precedence over PORT so this dev server and the API
// server can run side by side: both read PORT otherwise, and `strictPort: true`
// below turns the clash into a hard failure ("Port 8080 is already in use")
// rather than a silent reassignment.
//
// Production is unaffected: the built SPA is served by the API server, so only
// PORT matters there, and the Docker build sets it alone.
const portSource = process.env.FRONTEND_PORT ? 'FRONTEND_PORT' : 'PORT';
const rawPort = process.env.FRONTEND_PORT ?? process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided ' +
      '(set FRONTEND_PORT to run this server alongside the API).',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid ${portSource} value: "${rawPort}"`);
}

// ── Port de l'API, pour le proxy /api ────────────────────────────────────────
//
// Sans proxy, le SPA interrogeait le serveur VITE, qui ne connaît pas ces
// routes : l'application démarrait, s'affichait, et se comportait comme si les
// données n'existaient pas. La page d'acceptation annonçait « Lien invalide ou
// expiré » sur un jeton parfaitement valide — le message accusait la donnée
// alors que le problème était le routage. C'est le premier écran que voit
// quelqu'un qui installe ce dépôt, et il mentait sur l'état du système.
//
// En production le proxy ne sert pas : l'API sert elle-même le SPA bâti, donc
// même origine. Le port est LU dans l'environnement et non figé — le dépôt
// sépare déjà FRONTEND_PORT (ce serveur) et PORT (l'API).
const apiPort = Number(process.env.PORT ?? 8080);

if (Number.isNaN(apiPort) || apiPort <= 0) {
  throw new Error(`Invalid PORT value for the API proxy: "${process.env.PORT}"`);
}

if (apiPort === port) {
  throw new Error(
    `FRONTEND_PORT (${port}) et PORT (${apiPort}) sont identiques : le proxy /api ` +
      `se renverrait la requête à lui-même. Donnez deux ports distincts.`,
  );
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
