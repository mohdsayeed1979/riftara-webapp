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
| `STORAGE_DRIVER` | local | local \| supabase \| s3 |
| `STORAGE_LOCAL_DIR` | ./storage | |
| `STORAGE_MAX_UPLOAD_MB` | 25 | |

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
