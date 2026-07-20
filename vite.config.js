import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Panorama-Lens-Trip-Article-Tool/',
  server: {
    port: 3000,
    proxy: {
      '/Panorama-Lens-Trip-Article-Tool/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/Panorama-Lens-Trip-Article-Tool/, ''),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
});
