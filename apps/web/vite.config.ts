import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// При разработке веб работает на своём порту и передаёт запросы сервису на 3000.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
