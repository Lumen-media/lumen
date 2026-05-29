import path from "node:path";
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';
import { lumenHostModules } from './scripts/vite-plugin-lumen-host-modules';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const buildDate = new Date().toISOString().split('T')[0];

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    tanstackRouter({
      routesDirectory: "./src/app",
    }),
    lumenHostModules(),
  ],

  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },

  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
    },
  },

  optimizeDeps: {
    include: ['react/jsx-runtime', 'react/jsx-dev-runtime'],
  },

  clearScreen: false,

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
