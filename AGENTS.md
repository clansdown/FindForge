# Agent Notes

## Tech Stack
- Svelte 5 + Vite + TypeScript SPA. `src/main.ts` uses `mount(App, …)`, not `new App({target})`.
- No test framework or tests exist; do not attempt `npm test`.

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build (outputs to `dist/`)
- `npm run preview` — preview production build
- `npm run check` — typecheck; runs `svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json`
  - `tsconfig.node.json` enforces `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax`. Unused imports/variables will fail CI-like checks.

## Architecture & Entrypoints
- App entry: `src/main.ts` → `src/App.svelte`.
- Core business logic lives in `src/lib/`: `research.ts`, `deep_research.ts`, `models.ts` (OpenRouter client), `storage.ts` (persistence), `opfs.ts` (namespaced OPFS I/O).
- Sync infrastructure: `src/cloudSync.ts` (B2-backed sync engine), `src/syncJournal.ts` (event-sourced journal), `src/types/cloudSync.ts` (sync types).
- Auth: `src/auth.ts` (Clerk authentication).
- Types are centralized in `src/lib/types.ts`.

## External Dependencies & Runtime
- Requires an OpenRouter.ai API key (free account, but most models cost money; free-tier models exist).
- Clerk auth: requires `public/clerk-key.js` (gitignored) which sets `window.CLERK_PUBLISHABLE_KEY`. Install `@clerk/clerk-js` as a dependency.
- Dev server CSP is hardcoded in `vite.config.ts`. If you add new external APIs or scripts, update the `Content-Security-Policy` header there.
- Cloud sync connects to `https://findforge-storage.chris-f57.workers.dev` (or `http://localhost:8787` when `USE_DEV_WORKER = true`).

## Storage & OPFS Namespacing
- Part of the FindForge suite; OPFS prefix is `research/`. Other apps use `images/`, `translate/`.
- **`/research/`** — app data (conversations, preferences). Synced to cloud under `research/`.
- **`/credentials/`** — shared API keys (`openrouter`, etc.). Synced to cloud under `credentials/`. Shared across all FindForge apps.
- **`/cloud/`** — local-only shared settings (`cloudSyncEnabled`, `cloudSyncDeleteRemote`). **Never synced.**
- **`/sync/`** — local crash-recovery journal files (`journal-a`, `journal-b`, `checkpoint`). **Never synced.**
- One-time migration (`migrateToNamespacedPaths()`) copies old root-level OPFS data into `/research/` on first access.
- `push_to_production.sh` is gitignored; it builds and `scp`s `dist/` to `highsorcery.com:/var/www/machine_learner/`.

## Cloud Sync Architecture
- **Auth:** Clerk session tokens. Sync is opt-in (enable in Settings → Cloud Sync).
- **App-data pipeline:** Journal → 5s debounce → batch upload to B2 via Cloudflare Worker.
- **Credential pipeline:** No journal, no debounce. Writes upload immediately. Downloads happen on startup and manual request.
- **Init order (critical):** `initAuth()` → `getOPFSHandle()` (migration) → `loadConfig()` + `loadConversations()` → `initCloudSync()` → mount App.
- Config must be loaded before `initCloudSync()`, otherwise stale defaults overwrite synced config.

## Sync Instrumentation Rules

Any write or delete to `/research/` (app data) must be paired with sync
journaling so the cloud sync engine detects the change.

| Path | journal? | queueSync? | Why |
|------|----------|------------|-----|
| `/research/*` (app data) | Yes (`recordWrite`/`recordDelete`) | Yes | Tracked for cloud sync |
| `/credentials/*` | No | No | Immediate `syncCredentialToCloud()` |
| `/cloud/*` | No | No | Never synced |
| `/sync/*` | No | No | Crash recovery only |
| `preferences/syncManifest` | No | No | Updated atomically inside lock |
| Bulk downloads | No | No | Manifest updated atomically |

**Pattern for new app-data writes:**

```ts
import { recordWrite } from '../syncJournal';
import { queueSync, computeHash } from '../cloudSync';

async function writeSomething(data: string): Promise<void> {
    await writeLocalFile('myfeature/data.json', data);
    const hash = computeHash(data);
    recordWrite('myfeature/data.json', hash);
    queueSync();
}
```

## Style & Linting
- Prettier: `printWidth: 150`, `tabWidth: 4` (`.prettierrc`).
- Stylelint: `stylelint-config-standard` (`.stylelintrc.json`).
- `.vscode/settings.json` suppresses Svelte a11y warnings.

## Code Quality Rules

### No `any` — type everything precisely
- **Default:** give every value an exact type. Do not reach for `any`.
- **When full typing is impractical**, prefer these documented alternatives in order:
  1. `unknown` with a runtime type guard or narrowing.
  2. A narrowly-scoped `interface` / `type` for the shape you actually consume.
  3. `@ts-expect-error` with a comment explaining why the type is unrepresentable.
- **Acceptable exceptions** (still comment why):
  - `catch (e: any)` in error handlers.
  - Generic JSON parsing where the schema is truly unbounded and immediately passed to a typed consumer.

### Naming
- **No type information in names.** Use `userList`, not `userListArray`; `isLoading`, not `isLoadingBool`; `elapsedMs`, not `elapsedNumber`. The type system handles types.
- **Include units.** `timeoutMs`, `delaySeconds`, `timestampMs`, `sizeBytes`, `ratePerMinute`.
- **Names must reveal intent.** Prefer `currentConversation` over `d`; `handleApiError` over `errHandler`. A reader should understand purpose without reading the implementation.

## Missing / Notable
- No CI workflows, no pre-commit hooks, no monorepo tooling.
- `TODO.txt` exists but is not a task tracker for agents.
- Run `npm install` after pulling to install new dependencies (e.g. `@clerk/clerk-js`).
- Run `cleanup_google_drive.sh` to remove stale Google Drive files from disk.
