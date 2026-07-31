# Local Development — Docmost fork (`feat/collections`)

Verified working on macOS (Colima Docker, Node 25, pnpm 11.15.1) on 2026-07-31.

## Prerequisites

- **Node** ≥ 20 (tested on v25.3.0).
- **pnpm 11.15.1** — pinned via `packageManager`. Install: `npm i -g corepack && corepack enable pnpm`.
- **Docker** via Colima: `colima start` (brings up the Docker VM; `docker info` should then succeed).

## Ports — IMPORTANT

This machine already runs other services on the default Postgres/Redis ports
(Cloud SQL proxy on 5432, a native Postgres on 5433, ssh tunnels on 5432/6379).
So dev Postgres/Redis are moved to **uncommon** host ports:

| Service   | Container port | Host port | Why |
|-----------|----------------|-----------|-----|
| Postgres  | 5432           | **55432** | 5432/5433 taken |
| Redis     | 6379           | **63790** | 6379 taken |
| Server    | —              | 3000      | free |
| Client    | —              | 5173      | free |

If you clone this on a clean machine, you can revert to 5432/6379 in
`docker-compose.dev.yml` + `.env`. On *this* machine, keep the high ports.

## One-time setup

```bash
cd ~/Documents/CLI_LLM/docmost

# 1. install deps
pnpm install

# 2. env (already present as .env — dev-only APP_SECRET, do NOT commit)
#    DATABASE_URL points at localhost:55432, REDIS_URL at localhost:63790

# 3. start Postgres + Redis (dev-only compose: db + redis with host ports)
docker compose -f docker-compose.dev.yml up -d

# 4. build shared workspace packages (needed before server tests resolve)
pnpm run editor-ext:build

# 5. run migrations
cd apps/server && pnpm run migration:latest && cd ../..
```

## Run the app

```bash
cd ~/Documents/CLI_LLM/docmost
pnpm dev          # server :3000 + client :5173 concurrently
```

Open **http://localhost:5173**. First run shows a setup screen — create the
workspace + admin user, then a space, then pages.

Backend-ready log line: `Nest application successfully started` +
`Listening on http://localhost:3000`, preceded by
`Database connection successful` and Redis `connection was successfully established`.

## Tests

```bash
# client (Vitest) — 58/58 green
cd apps/client && pnpm test

# server (Jest) — see DEV-baseline-notes.md for the real green baseline;
# some upstream unit specs are pre-existing stubs and fail out of the box
cd apps/server && pnpm test
```

## Stop / reset

```bash
# stop app: Ctrl-C the `pnpm dev` process
docker compose -f docker-compose.dev.yml stop        # stop db+redis, keep data
docker compose -f docker-compose.dev.yml down        # remove containers, keep volumes
docker compose -f docker-compose.dev.yml down -v      # NUKE data (fresh initdb)
```

> Note: `POSTGRES_PASSWORD` only applies when the data volume is first created.
> If you change DB creds, `down -v` first or the old password persists.
