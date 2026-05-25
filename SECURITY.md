# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Conflux, please **do not** open a public GitHub issue.

Instead, email the maintainers directly or open a [GitHub Security Advisory](../../security/advisories/new).

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested mitigations

You can expect an initial response within **72 hours** and a resolution timeline within **14 days** for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |

## Security Considerations for Deployment

- Always generate strong secrets for `JWT_SECRET`, `API_KEY_PEPPER`, `NEXTAUTH_SECRET`, and `INTERNAL_API_SECRET`
- Use `openssl rand -base64 32` to generate each secret
- Never commit `.env` or `ui/.env.local` to version control
- Restrict `TELEGRAM_ALLOWED_USER_IDS` to known Telegram user IDs
- Run behind a reverse proxy (nginx/Caddy) with TLS in production
- Set `DATA_GUARD_ENABLED=true` in production to prevent destructive tool actions
