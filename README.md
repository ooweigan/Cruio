# Cruio

Cruio is an AI image and video creation Web SaaS under active V1 construction. The
current checkpoint provides the fixed Toonflow-derived Vue/Vite/Vue Flow canvas, an
Express API, and local PostgreSQL persistence; it is not a production release.

## Local development

Prerequisites: Bun 1.3.14 or newer, PostgreSQL listening on `127.0.0.1:5432`, database
`cruio_dev`, role `cruio_app`, and its password stored in macOS Keychain under service
`cruio-dev-postgres` / account `cruio_app`. The password is read at runtime and must not
be placed in an environment file.

```bash
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

Open <http://localhost:5173>. The Web app proxies `/api` to the Express server at
<http://127.0.0.1:3000>. The server also applies pending migrations at startup. Verify
it with `curl http://127.0.0.1:3000/api/health`.

## Checks

```bash
bun run typecheck
bun run build
bun run test
```

## Scope and provenance

The V1 baseline and accepted business decisions live in `requirements/`. Upstream
source and licensing details are recorded in `UPSTREAM.md` and `LICENSE`. The product
does not currently connect to real model suppliers, payment, orders, memberships, or
commissions.
