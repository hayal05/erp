# Production build verification — task 5.3

From the project root after dependencies are installed:

```sh
npm run build
npm --prefix backend run check:production
```

## Backend

The backend ships native JavaScript ES modules; it needs no transpilation or generated dist directory. `backend/scripts/build.mjs` recursively validates all 57 `backend/src/**/*.js` files using Node's syntax checker. The command needs no runtime secrets. `npm run build` now runs backend validation before building the frontend.

`check:production` launches the real server with NODE_ENV=production, a temporary generated session secret, an unused local database address and no Cloudinary credentials. It verifies successful startup, /health 200, configured CORS, anonymous HR access denied with 401, startup without required configuration refused, and no generated credentials in startup output. It shuts the child server down after the check. No database or Cloudinary request is made; this is a production boot smoke, not an integration test or a migration check.

## Frontend

Vite production build passed, transforming 1,714 modules:

| Artifact | Size | Gzip |
|---|---:|---:|
| HTML | 0.82 kB | 0.45 kB |
| CSS | 18.13 kB | 4.53 kB |
| JavaScript | 337.03 kB | 105.04 kB |

The generated production bundle was served with Vite preview and exercised in Chromium using mocked API responses. Seven dashboard metrics, links/lists, refresh, desktop/mobile layout, empty/error/retry states and employee redirection passed without page runtime errors. The API was mocked; live service and database validation remain separate.

The source package excludes node_modules and generated dist. Build recreates dist for hosting. Deploy configuration is task 5.4; startup migration/memory verification is task 5.5. Task 5.2 still awaits 12 native PostgreSQL multi-connection cases, and real provider/device checkpoints remain pending. These build results do not imply deployment readiness.
