// Central, validated configuration. Fails fast in production if secrets are missing.
const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function need(name, devDefault) {
  const v = env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable: ${name}`);
  return devDefault;
}

const num = (name, def) => {
  const n = Number(env[name] ?? def);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
};

const sameSite = (env.COOKIE_SAMESITE || 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('COOKIE_SAMESITE must be lax, strict or none');

export const config = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port: num('PORT', 4000),
  databaseUrl: need('DATABASE_URL', ''),
  // Single-service hosting: the app and API share one origin. Render supplies RENDER_EXTERNAL_URL, so
  // FRONTEND_URL is only needed locally (Vite on :5173) or when serving from a custom domain.
  frontendUrl: (env.FRONTEND_URL || (isProd && env.RENDER_EXTERNAL_URL) || need('FRONTEND_URL', 'http://localhost:5173')).replace(/\/+$/, ''),
  sessionSecret: need('SESSION_SECRET', 'dev-only-secret-change-me-dev-only-secret'),
  company: {
    name: env.COMPANY_NAME || 'Natra',
    timezone: env.COMPANY_TIMEZONE || 'Africa/Addis_Ababa',
  },
  // Use 'lax' when the app and API share a site (custom domain or proxy). Only use 'none'
  // for a cross-site deployment; it forces Secure and may be blocked by some browsers.
  cookie: { sameSite, secure: isProd || sameSite === 'none' },
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  },
};

if (isProd && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
