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

The signed-in flow is intentionally layered: the projects page is the entry point,
each project detail page shows its saved works and bound workflows, and the project
canvas is separate from a workflow's source graph. Create a workflow in the workflow
library, bind it from a project detail page, then place its version-pinned reference
on that project's canvas. Nodes can be selected, dragged, connected, and removed;
ordinary nodes can also be renamed. Changes auto-save to PostgreSQL. Selecting a node
or edge alone does not create a new saved version. A project-canvas reference is layout
only: removing it does not remove the binding or source workflow. Model execution is
not connected yet. "Add node" opens a type picker first; only the currently implemented
types can be selected.

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
