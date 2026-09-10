# Environment Variables

Copy `.env.example` to `.env`. Only `NEXT_PUBLIC_*` variables are exposed to the
browser; everything else is server-only. **Never commit a real `.env`.**

## Application
| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | development | development \| test \| production |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | http://localhost:3000 | Base URL |

## Database
| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_DRIVER` | pglite | `pglite` (embedded) or `postgres` (managed) |
| `DATABASE_URL` | postgresql://… | Required when driver = postgres |
| `PGLITE_DATA_DIR` | ./.data/riftara-db | Embedded DB location |

## Authentication
| Variable | Default | Notes |
| --- | --- | --- |
| `AUTH_SECRET` | — | **Required**, ≥32 bytes. `openssl rand -base64 48` |
| `AUTH_SESSION_TTL_HOURS` | 12 | Session lifetime |
| `AUTH_PROVIDER` | credentials | credentials \| supabase |
| `AUTH_MFA_ENABLED` | false | |

## Demo / seed
| Variable | Default | Notes |
| --- | --- | --- |
| `DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE` | true | Shows the demo banner; flags seeded rows |
| `SEED_DEFAULT_PASSWORD` | Riftara#2025 | Password for seeded demo accounts |

## Storage
| Variable | Default | Notes |
| --- | --- | --- |
| `STORAGE_DRIVER` | local | Only `local` is implemented (Phase 11A). `s3` is planned (Phase 11B); `supabase` is not required. |
| `STORAGE_LOCAL_DIR` | ./storage | Directory for the local filesystem driver (relative to the working dir; portable to Ubuntu). |
| `STORAGE_MAX_UPLOAD_MB` | 25 | Maximum document upload size. |

### Document storage (Phase 11A)
Document files are written through a storage abstraction (`src/lib/storage`), never
public URLs; downloads are streamed through the authenticated route
`GET /api/v1/documents/[id]/download`. The `storage/` directory is git-ignored.

- **Ubuntu / self-hosted:** `STORAGE_DRIVER=local` is suitable **only** when
  `STORAGE_LOCAL_DIR` points at a **persistent disk** (or a mounted volume) that
  survives restarts and is backed up.
- **Vercel production:** the filesystem is **ephemeral** — local storage is **NOT**
  persistent there and must not be used for real documents. Use an S3-compatible
  driver (deferred to Phase 11B) when running document storage on Vercel.
- Uploads are restricted to a business-document MIME allow-list (PDF, JPEG, PNG,
  WEBP, Word, Excel, CSV); executables/scripts are rejected.

## Supabase (when used)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`.

## Maps
`MAP_PROVIDER` (static \| google \| mapbox), `GOOGLE_MAPS_API_KEY`,
`NEXT_PUBLIC_MAPBOX_TOKEN`. The default `static` provider renders the built-in
Saudi portfolio map with no key.

## API
`API_RATE_LIMIT_PER_MINUTE` (120), `API_KEY_SALT`.

## Email (SMTP)
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

## Integrations (blank ⇒ "Not Connected" / "Configuration Required")
Ejar: `EJAR_API_BASE_URL`, `EJAR_API_KEY` ·
WhatsApp: `WHATSAPP_API_BASE_URL`, `WHATSAPP_API_TOKEN` ·
Payments: `PAYMENT_GATEWAY_BASE_URL`, `PAYMENT_GATEWAY_KEY` ·
ERP: `ERP_API_BASE_URL`, `ERP_API_KEY` ·
Google Ads/Analytics, Meta, TikTok, Snapchat, LinkedIn Ads (client id/secret) ·
Zoho (`ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`) · monday (`MONDAY_API_TOKEN`) ·
Website (`WEBSITE_WEBHOOK_SECRET`).

Connection status is derived from the presence of these — configuring the
credentials is what flips a connector to *Connected*.
