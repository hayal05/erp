import { config } from '../config.js';

// Needed locally (Vite :5173 -> API :4000). In production the app is served by this same server, so requests
// are same-origin and CORS is not involved. Allow exactly one origin with credentials; nothing else is reflected.
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && origin === config.frontendUrl) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Data-Delta',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
