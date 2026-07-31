# Phase 3 Hand-off — Collections table-view frontend

Resume point for the Notion-style database feature. Backend (Phases 0–2) is **merged to `main`** (PR #1). This doc lets a fresh session — on any machine — pick up Phase 3.

## Where things stand
- Backend complete + on `main`: schema migration, typed cell helpers, 4 repos, and the `collections/*` endpoints (create / convert / info / delete; property, row, view CRUD; `rows/list` with filter/sort + per-page + row-level access filtering).
- Hardened by **two** two-model adversarial review rounds. All confirmed findings fixed. 51 e2e tests green, server typecheck clean.
- Full design spec + phased plan live in the **monorepo** (not this repo):
  - Spec: `~/Documents/CLI_LLM/docs/specs/2026-07-31-notion-database-docmost-spec.md` (§6 = frontend contract)
  - Plan: `~/Documents/CLI_LLM/docs/superpowers/plans/2026-07-31-docmost-notion-database.md` (Phase 3 task list)

## Start a Phase 3 session
1. Branch fresh off `main`: `git checkout main && git pull && git checkout -b feat/collection-table-ui`
2. Bring the app up per `DEV.md` (Postgres :55432, Redis :63790 via `docker-compose.dev.yml`, `pnpm dev`). Server :3000, client :5173.
3. Work Phase 3 test-first, task by task, per the plan. New dir: `apps/client/src/features/collection/`.

## Phase 3 tasks (from the plan — expand each to TDD steps at start)
- **3.1** React Query hooks + `collection-service.ts` (the `api.post` calls to `collections/*`).
- **3.2** Table shell on TanStack Table + TanStack Virtual; columns from property defs, rows from `rows/list`.
- **3.3** Six cell editors — text, number, dropdown, date (`@mantine/dates`), checkbox, and **Title** (writes via the page-title REST path, NOT `rows/update`) [R3].
- **3.4** Column header menu — rename, delete, insert, sort-by, reorder (drag via `@atlaskit/pragmatic-drag-and-drop`). **No change-type** [R10].
- **3.5** Add-row / delete-row; inline cell edit → `rows/update`.
- **3.6** Filter + sort UI writing `config` on the view.

## Backend facts the frontend needs
- Every row IS a real Docmost page; Title = the page title; other cell values live in `collection_rows.cells` keyed by property **id**.
- Endpoints are POST-only under `collections/`. `rows/list {collectionPageId, viewId}` returns `{rows: [{id, pageId, title, cells, position}]}`, already access-filtered + trashed-excluded.
- Filter operators implemented (frontend must match): text/title `contains|equals|is_empty|is_not_empty`; number `equals|not_equals|gt|gte|lt|lte|is_empty|is_not_empty`; date `before|after|on|is_empty|is_not_empty` (strict ISO values only); select `equals|not_equals|is_empty|is_not_empty`; checkbox `equals`. Sorts: `{propertyId, direction}`, cap 5.
- Custom editor nodes (inline-collection embed, later) must register in the SERVER `tiptapExtensions` too, or search/export/duplicate break [R4].

## Notes / gotchas (carried from Phases 0–2)
- Dev DB/Redis on **non-standard ports** (55432 / 63790) — defaults are taken on the primary dev machine.
- e2e suite: run `pnpm test:e2e -- collection.e2e --forceExit`; jest **lingers after the pass summary** (leaked ioredis handle) — `Tests: N passed` = success, then `pkill -9 -f jest`.
- Never blind-`migration:codegen` the whole `db.d.ts` (it mistypes int8 columns the app parses to number) — hand-add new types.
