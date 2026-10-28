import { reportFailure } from '../services/logging.js';
import { config } from '../config.js';

// Throw this from routes/services; the handler turns it into a JSON response.
export class HttpError extends Error {
  constructor(status, message, code = 'error', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Express 4 does not catch rejected promises; wrap async route handlers with this.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (req, res) =>
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });

// Express recognises error handlers by their 4 arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code || 'error';
  let message = err.message;

  if (err.type === 'entity.parse.failed') [status, code, message] = [400, 'bad_json', 'Invalid JSON body'];
  else if (err.type === 'entity.too.large') [status, code, message] = [413, 'too_large', 'Request body too large'];
  else if (!(err instanceof HttpError) && status < 500) code = 'bad_request';

  if (status >= 500) {
    // Fixed event/code only: exception messages, paths and stacks can contain secrets.
    if (!config.isTest) reportFailure('request', err);
    code = 'server_error';
    if (config.isProd) message = 'Internal server error';
  }

  if (res.headersSent) return next(err);
  res.status(status).json({ error: { code, message, ...(status < 500 && err.details ? { details: err.details } : {}) } });
}
