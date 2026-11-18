import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5174,
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true,
      },
    },
  },
});

