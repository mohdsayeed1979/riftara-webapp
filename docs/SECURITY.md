# Security

Aligned to BRD §148-149.

## Authentication & sessions
- Passwords hashed with **scrypt** (memory-hard, RFC 7914), no plaintext ever stored.
- Sessions: signed JWT (HS256) **bound to a server-side session record**, so
  revoking a session in the database immediately invalidates the cookie.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Strong password policy enforced (length, classes, no trivial repeats).
- **Login monitoring & lockout:** failed attempts recorded in `login_attempts`;
  the account locks for 15 minutes after 5 failures; response timing does not
  reveal whether an account exists.
- MFA-ready (`AUTH_MFA_ENABLED`); auth provider swappable to Supabase Auth
  without touching the rest of the app.

## Authorization
- Permission-based RBAC with data-level scoping (see [RBAC.md](RBAC.md)),
  least-privilege by default.

## Transport & headers
- HTTPS-ready; `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` set globally.

## Data protection
- Secrets are server-only; only `NEXT_PUBLIC_*` reach the browser. `.env` is
  git-ignored; `.env.example` holds placeholders only.
- Sensitive fields (password/token/key/secret hashes) are redacted before being
  written to the audit trail.
- Identification, mobile, financial and corporate data are access-controlled by
  permission and scope.

## Audit trail (BR-017)
- Append-only `audit_logs` (guaranteed by a database trigger) records user,
  timestamp, action, entity, before/after values, changed fields, reason,
  approval reference, IP and device. Normal users cannot edit or delete entries.

## API security
- API-key auth (hashed keys, scoped), Zod validation on every input, per-principal
  rate limiting, structured errors with no stack-trace leakage.

## Data integrity
- Financial and legal records cannot be hard-deleted (BR-012, BR-013);
  they are cancelled, waived or reversed. Concurrency-safe uniqueness and
  overlap rules are enforced at the database level.

## Backup & DR (BRD §150)
- With managed PostgreSQL/Supabase: daily + incremental backups, point-in-time
  recovery and offsite storage. Define RPO/RTO per the deployment target — see
  [DEPLOYMENT.md](DEPLOYMENT.md).

## Running a security review
`npm run verify` runs typecheck, lint and the full test suite, including the
integrity-constraint tests that prove the deletion/append-only protections.
