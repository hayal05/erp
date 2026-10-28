import { config } from '../config.js';

// Frontend (Render static site) and API are on different origins, so allow
// exactly one origin with credentials. Nothing else is ever reflected.
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && origin === config.frontendUrl) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
