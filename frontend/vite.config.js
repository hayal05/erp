import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// Dev: the API's CORS and CSRF Origin check allow exactly FRONTEND_URL (http://localhost:5173), so refuse to
// silently move to another port. Production: the API serves the built dist/ on the same origin.
export default defineConfig({
  plugins: [react()],
  // One root .env for local API and frontend; Vite exposes only its VITE_ prefix.
  envDir: fileURLToPath(new URL('../', import.meta.url)),
  envPrefix: 'VITE_',
  server: { port: 5173, strictPort: true },
});
