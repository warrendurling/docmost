# Server test baseline — upstream v0.95.0 @ 70d2ff8 (branch feat/collections)

Unmodified upstream checkout. `cd apps/server && pnpm test` (Jest):
**Test Suites: 16 failed, 8 passed, 24 total. Tests: 14 failed, 145 passed, 159 total.**

## Bottom line

The realistic green baseline is **8/24 suites fully green, 145/159 individual tests pass**.
All 16 failing suites are pre-existing upstream noise — 14 are auto-generated NestJS stub
specs with zero mocks (guaranteed DI failure by construction), and 2 share one upstream
Jest-config gap (`.tsx` not in `moduleFileExtensions`). None are caused by this local
environment (DB/Redis/.env all correctly wired — 145 tests that *do* need those pass fine).
Upstream CI (`.github/workflows/release.yml`) never runs `pnpm test` at all — only docker
build + release on tag push — so a green unit suite was never an upstream requirement.
Safe to ignore all 16 for TDD; write new specs the normal way and this baseline won't move.

## Classification table

| Suite | Cause category | Evidence | Expected to pass upstream? |
|---|---|---|---|
| `core/space/services/space.service.spec.ts` | stub-spec | `providers: [SpaceService]` only, no mocks → `Nest can't resolve... SpaceRepo` | No |
| `core/space/space.controller.spec.ts` | stub-spec | same root cause (SpaceService DI chain) | No |
| `core/search/search.controller.spec.ts` | stub-spec | `JwtAuthGuard` needs `EnvironmentService`, not provided | No |
| `core/search/search.service.spec.ts` | stub-spec | needs `KyselyModuleConnectionToken` etc., not provided | No |
| `integrations/environment/environment.service.spec.ts` | stub-spec | needs `ConfigService`, not provided | No |
| `core/group/group.controller.spec.ts` | stub-spec | needs `GroupRepo` etc., not provided | No |
| `core/group/services/group.service.spec.ts` | stub-spec | same as above (GroupService DI chain) | No |
| `core/user/user.controller.spec.ts` | stub-spec | needs `UserRepo`, not provided | No |
| `core/auth/services/token.service.spec.ts` | stub-spec | needs `JwtService`, not provided | No |
| `integrations/storage/storage.service.spec.ts` | stub-spec | needs `STORAGE_DRIVER_TOKEN`, not provided | No |
| `core/workspace/services/workspace.service.spec.ts` | stub-spec | needs `WorkspaceRepo` + 15 other deps, not provided | No |
| `core/page/services/page.service.spec.ts` | stub-spec | needs `PageRepo` + 10 other deps, not provided | No |
| `core/page/page.controller.spec.ts` | stub-spec | same (PageService DI chain) | No |
| `core/comment/comment.service.spec.ts` | stub-spec | needs `CommentRepo` etc., not provided | No |
| `core/auth/services/auth.service.spec.ts` | module-resolution | `Could not locate module @docmost/transactional/emails/change-password-email` — file exists as `.tsx` but Jest `moduleFileExtensions` = `["js","json","ts"]` (no `tsx`) | No |
| `core/auth/auth.controller.spec.ts` | module-resolution | same root cause (imports auth.service.ts transitively) | No |

## Detail: the 14 stub-specs

All are Nest CLI's default `nest generate service/controller` boilerplate:

```ts
beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [SpaceService],   // <- only the class under test, zero mocks for its deps
  }).compile();
  service = module.get<SpaceService>(SpaceService);
});
it('should be defined', () => { expect(service).toBeDefined(); });
```

`git log` on `space/services/space.service.spec.ts` and `auth/services/token.service.spec.ts`
shows last touch **Jan 9 2024 / Mar 22 2024** ("switch to nx monorepo" / early commits) —
old, untouched, never wired with real providers or mocks. Every real service in this repo
has non-trivial constructor deps (repos, Kysely connection, BullMQ queues, EE audit symbol),
so these specs fail deterministically on any machine, any config. Confirmed not
environment-specific.

## Detail: the 2 module-resolution failures

```
Could not locate module @docmost/transactional/emails/change-password-email mapped as:
.../apps/server/src/integrations/transactional/$1
moduleNameMapper: { "^@docmost/transactional/(.*)$": "<rootDir>/integrations/transactional/$1" }
```

File exists: `src/integrations/transactional/emails/change-password-email.tsx` (react-email
template, `.tsx`). `package.json`'s jest block sets
`"moduleFileExtensions": ["js", "json", "ts"]` — `tsx` is missing, so Jest can't resolve the
mapped path to the `.tsx` file. This is a real upstream Jest-config gap (one-line fix:
add `"tsx"` to `moduleFileExtensions`), not something caused by this local setup —
`package.json` is byte-identical to upstream (`git status` clean, `git log` shows last
touch was the v0.95.0 tag / hocuspocus-v4 commit, both pre-fork). Left unfixed per
instructions (read-only task); flagging as a legitimate low-cost upstream bug worth a
one-line fix later if these two specs ever matter, but not required for the TDD baseline.

## CI cross-check

`.github/workflows/release.yml` is the **only** workflow in the repo. It triggers on tag
push / manual dispatch and does: checkout → docker buildx → build+push image → create
GitHub release. It never runs `pnpm test`, `pnpm lint`, or `pnpm build` as a gate — no
`jest` invocation anywhere in `.github/workflows/`. So a green `pnpm test` run has never
been an upstream expectation; these 16 broken suites have presumably been broken in every
upstream commit since Jan/Mar 2024 with nothing to catch them.

## What passes (145/159, 8/24 suites)

Everything that isn't one of the 16 above passes cleanly, including specs that legitimately
exercise real logic (not just stub DI) — confirming local Postgres (55432) / Redis (63790) /
`.env` are correctly wired for the units that do need them. No environment fix needed.
