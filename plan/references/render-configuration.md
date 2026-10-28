# Render configuration — task 5.4

`render.yaml` is at the project root beside `backend/`, `frontend/` and `database/`. Use that directory as the Git repository root. This file defines both services; no Render account changes or deployment were performed here.

## Service layout

| Service | Runtime | Build | Start / publish |
|---|---|---|---|
| natra-erp-api | Node 24, free web instance | Production-only backend install, then native-module validation | Direct-URL migration process succeeds before the API starts; /health probe |
| natra-erp-web | Static site, Node 24 at build time | Frontend install including Vite, then production build | frontend/dist; all application paths rewrite to /index.html |

Both services keep the repository root. Do not set the API's rootDir to backend: Render excludes files outside that root, and the migration runner needs the sibling database/migrations directory. Build filters target the appropriate source folders. Automatic redeploy on commits is off until the outstanding validation is signed off.

No Render-managed PostgreSQL service is declared: DATABASE_URL and MIGRATION_DATABASE_URL come from the existing Neon database. No disk is needed for sessions or selfies (PostgreSQL and private Cloudinary storage own them).

## Environment matrix

| Variable | API service | Static frontend | Local / one-off use |
|---|---|---|---|
| NODE_VERSION | 24 | 24 during build | .node-version selects the same major |
| NODE_ENV | production | production during build | Defaults to development; not set in shared .env so it cannot turn a Vite build into a development React bundle |
| PORT | Supplied by Render | Not applicable | 4000 |
| DATABASE_URL | Secret: pooled Neon URL, SSL required | Never supplied | Direct local PostgreSQL URL |
| MIGRATION_DATABASE_URL | Secret: direct/non-pooler Neon URL, same database | Never supplied | Render start command only; local npm migrate uses DATABASE_URL |
| SESSION_SECRET | Render generates a random value | Never supplied | Generate/set a private value >=32 characters |
| FRONTEND_URL | User supplies the actual HTTPS frontend origin | Not needed | http://localhost:5173 |
| COOKIE_SAMESITE | none for cross-site frontend/API hosts | Not needed | lax for local or same-site custom domains |
| COMPANY_NAME | Natra (editable) | Not needed | Natra |
| COMPANY_TIMEZONE | Africa/Addis_Ababa (editable) | Not needed | Africa/Addis_Ababa |
| CLOUDINARY_CLOUD_NAME | User supplied, backend only | Never supplied | Required for live photos |
| CLOUDINARY_API_KEY | User supplied, backend only | Never supplied | Required for live photos |
| CLOUDINARY_API_SECRET | User supplied, backend only | Never supplied | Required for live photos |
| VITE_API_URL | Not needed | API service RENDER_EXTERNAL_URL reference | http://localhost:4000 |
| SEED_ADMIN_EMAIL / PASSWORD / NAME | Not persisted by Blueprint | Never supplied | One-off HR bootstrap from a private environment |
| TEST_DATABASE_URL | Not a runtime setting | Never supplied | Disposable database whose name contains test |

QR expiry is fixed at 45 seconds. The unused QR_TOKEN_TTL_SECONDS config property/template entry was removed so it cannot appear to be an effective deployment override.

## Setup details

1. Supply the pooled runtime Neon URL and the direct migration URL for the **same** database; retain sslmode=require in production. The migration runner uses a session advisory lock, which Neon's transaction-mode pooler does not support. The Render start command changes DATABASE_URL only for the migration subprocess, then starts the API with the original pooled runtime URL. A migration failure prevents API startup. Startup/memory verification remains task 5.5.
2. Supply the actual frontend HTTPS origin as FRONTEND_URL, without a route/path. If it is not known during initial Blueprint creation, update it after Render assigns the static URL and redeploy the API. Do not assume a globally unique onrender.com address from the display name.
3. VITE_API_URL references the API's public RENDER_EXTERNAL_URL, not its private-network host. It must be an origin without a trailing /api; the client adds /api itself. A changed frontend build-time variable requires a rebuild.
4. Supply private Cloudinary configuration. SESSION_SECRET is generated; no real credentials or default HR password are committed. Bootstrap HR once using the private SEED_ADMIN_* values; do not seed/reset HR on each restart.
5. Cookie sessions must be tested on the actual target browser. Cross-site hosts use SameSite=None with Secure (set automatically in production); browsers that block third-party cookies can still block those sessions. For reliable same-site hosting, use paired custom origins such as app.example.com and api.example.com, update FRONTEND_URL/VITE_API_URL and the Blueprint's COOKIE_SAMESITE to lax, and rebuild. Do not set a cookie Domain or move session tokens into localStorage as a workaround. Blueprint sync can overwrite manual dashboard settings, so keep custom-origin changes in the Blueprint too.
6. Local development: copy .env.example to repository-root .env and fill private values. Backend dev/seed/migrate scripts and Vite now read that root file; Vite exposes only VITE_-prefixed values. .env and .env.* are ignored by Git, with .env.example explicitly retained.

## Verification (2026-10-28)

- render.yaml passed the official published Render JSON Schema (draft 2020-12) and application-specific checks for two services, retained migration paths, health check, private-variable separation, generated secret, public API reference and SPA fallback.
- Every application/seed/migration/test variable is documented in .env.example; PORT and NODE_VERSION provider behavior is explained.
- Root-environment build test included a public VITE_API_URL sentinel and private session/database/Cloudinary sentinels. The resulting bundle contained the public origin and none of the private sentinels. The temporary file was removed and the ordinary production bundle rebuilt.
- An isolated clean backend install using npm ci --omit=dev installed only runtime dependencies; backend validation and production boot/health/CORS/guard/config smoke checks passed without dev dependencies.
- Backend 240 passed / 277 native DB skips; frontend 121 passed; root production build passed. Native task 5.2 concurrency cases and live Render/Neon/Cloudinary/device checks remain pending. Schema validation does not assert that a live deployment was created or succeeded.

## Primary references

- [Render Blueprint specification](https://render.com/docs/blueprint-spec) and [published JSON Schema](https://render.com/schema/render.yaml.json)
- [Render monorepo root-directory behavior](https://render.com/docs/monorepo-support)
- [Render public service URLs and default variables](https://render.com/docs/environment-variables)
- [Render Node version selection](https://render.com/docs/node-version)
- [Neon transaction-mode pooling limitations](https://neon.com/docs/connect/connection-pooling)
- [Vite envDir/envPrefix](https://vite.dev/config/shared-options#envdir)
- [MDN third-party cookie behavior](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies)
