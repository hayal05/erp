import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';

// Single-service hosting: the API also serves the built React app (frontend/dist).
// Everything here is inert unless frontend/dist/index.html exists AND the caller opts in,
// so tests and local API-only runs behave exactly as before.
export const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist');

// Cloudinary signed selfie links (api.cloudinary.com, redirecting to res.cloudinary.com) are shown in <img>.
const CLOUDINARY_IMG = ['https://api.cloudinary.com', 'https://res.cloudinary.com'];

// frontend/index.html has one small inline script (theme before first paint). Allow exactly that
// script by SHA-256 hash instead of weakening script-src with 'unsafe-inline'.
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return out;
}

// Content-Security-Policy for the HTML app: helmet's defaults plus what this app needs.
// blob: = selfie preview in the portal; data: = QR code image (already in helmet's default).
export function frontendHelmet(html) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", ...inlineScriptHashes(html)],
        'img-src': ["'self'", 'data:', 'blob:', ...CLOUDINARY_IMG],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'same-origin' },
  });
}

const NOT_APP = /^\/(api|health)(\/|$)/; // API and liveness stay JSON, never index.html
const HAS_EXT = /\.[a-z0-9]+$/i;         // a missing /assets/x.js or /favicon.ico must be a real 404

// Returns an Express router, or null when there is no build to serve.
export function frontendRouter(dist = DEFAULT_DIST) {
  const indexFile = path.join(dist, 'index.html');
  if (!fs.existsSync(indexFile)) return null;
  const html = fs.readFileSync(indexFile, 'utf8');
  const router = express.Router();

  // The app's CSP applies to pages and assets only, never to /api or /health responses.
  const csp = frontendHelmet(html);
  router.use((req, res, next) => (NOT_APP.test(req.path) ? next() : csp(req, res, next)));
  // Hashed Vite assets never change; index.html must always be revalidated.
  router.use('/assets', express.static(path.join(dist, 'assets'), { index: false, maxAge: '1y', immutable: true }));
  router.use(express.static(dist, { index: false, maxAge: 0 }));
  router.get('*', (req, res, next) => {
    if (NOT_APP.test(req.path) || HAS_EXT.test(req.path)) return next();
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  });
  return router;
}
