import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// The API's CORS and CSRF Origin check allow exactly FRONTEND_URL (http://localhost:5173 in dev),
// so refuse to silently move to another port.
export default defineConfig({
  plugins: [react()],
  // One root .env for local API and frontend; Vite exposes only its VITE_ prefix.
  envDir: fileURLToPath(new URL('../', import.meta.url)),
  envPrefix: 'VITE_',
  server: { port: 5173, strictPort: true },
});
