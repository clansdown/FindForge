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
- Tool implementations live in `src/tools/`: one file per tool, plus `registry.ts` for ToolRegistry construction.
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
- **`/doc-cache/`** — document cache for fetched papers / PDFs, private to this device. **Never synced.** Excluded via `SYNC_IGNORE_PREFIXES` in `cloudSync.ts`.
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
| `/doc-cache/*` | No | No | Document cache, private to device |
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

## Tools Architecture

All tool implementations live under `src/tools/`. Each file exports a `ToolDefinition` constant and its executor function. The `ToolRegistry` class in `registry.ts` composes them.

### File layout

```
src/tools/
  calculator.ts            — scientific_calculator
  wikipedia.ts             — wikipedia_search
  catholic_encyclopedia.ts — catholic_encyclopedia_search
  web_fetch.ts             — web_fetch (+ unified fetchUrl, DirectFetchCandidate, proxy fallback, shared WEB_PROXY_BASE_URL)
  pubmed_search.ts         — pubmed_search
  crossref_search.ts       — crossref_search
  pubmed_fetch.ts          — pubmed_fetch
  fetch_paper.ts           — fetch_paper (Crossref resolution, arXiv/bioRxiv/PDF pipelines, caching)
  stanford_encyclopedia_of_philosophy.ts — sep_search (DuckDuckGo site-search + DOM extraction via proxy)
  registry.ts              — ToolRegistry class + createToolRegistry factory
```

### ToolDefinition

Each tool definition carries its own metadata and formatters. Defined in `src/lib/types.ts`:

```ts
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
    displayName: string;
    formatArgs: (args: Record<string, unknown>) => string;
    formatResult: (result: string) => string;
}
```

`displayName`, `formatArgs`, and `formatResult` are used by:
- `research.ts` — populates `formattedArgs`/`formattedResult` on every `ToolCallProgress` and `ToolCallRecord`
- `Message.svelte` — displays them on one line with word-wrap
- `MessageInfo.svelte` — shows a summary line above the expandable raw details

### How to add a new tool

1. **Create the file** `src/tools/your_tool.ts`:

```ts
import type { ToolDefinition, ToolExecutionContext } from '../lib/types';

export const YOUR_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'your_tool_name',
        description: 'What this tool does.',
        parameters: { /* JSON Schema for args */ },
    },
    displayName: 'Your Tool Name',
    formatArgs(args) {
        return (args.query as string) || '';
    },
    formatResult(result) {
        if (result.startsWith('Error:')) return result;
        return `Got result (${result.length}b)`;
    },
};

export async function executeYourTool(
    args: Record<string, unknown>,
    _ctx: ToolExecutionContext,
): Promise<string> {
    // ... implementation ...
}
```

2. **Register in** `src/tools/registry.ts` — import and add to the `tools` array in `createToolRegistry()`:

```ts
{ definition: YOUR_TOOL, executor: executeYourTool },
```

3. **Add to** `defaultEnabledTools` in `src/lib/types.ts` `Config` class.

4. **Add checkbox** in `src/Settings.svelte` in the tools section.

5. **If the tool contacts an external API directly**, add the domain to `connect-src` in `vite.config.ts` CSP.

### ToolExecutionContext

```ts
export interface ToolExecutionContext {
    config: Config;
    signal?: AbortSignal;
    onStatus?: (status: string) => void;
}
```

Tools can call `ctx.onStatus?.('Converting PDF...')` to give the user intermediate feedback. Used by `fetch_paper` and `web_fetch`.

### Paper cache (in-memory, `src/lib/paperCache.ts`)

Fast first-level cache keyed by **document ID** (DOI, arXiv ID, etc.). Persists only for the page session. Not OPFS-backed. Used by `fetch_paper` to avoid re-resolving the same paper within a conversation.

### Document cache (OPFS-backed, `src/lib/docCache.ts`)

Persistent LRU cache stored under `/research/doc-cache/`. **Never synced.** Keyed by **URL** (raw content) and `extracted:{docId}` (post-parse markdown). Evicts least-recently-accessed entries when over the size limit. Limit configurable in Settings, stored at `/cloud/preferences/docCacheSizeLimit` (default 1 GB). Warns via console when usage exceeds 90% on non-PWA installs.

### Web Fetch — unified fetch with fallback

`fetchUrl(url, token, options?)` in `src/tools/web_fetch.ts` is the single entry point for all web fetching:

1. Checks `DirectFetchCandidate[]` — APIs known to support CORS (Wikipedia, Crossref) get a direct `fetch()` call
2. If the candidate's direct fetch fails (CORS or HTTP error), **falls back to the Cloudflare proxy**
3. If no candidate matches, goes directly to the proxy
4. Optional `headers` in `FetchOptions` are merged with candidate headers and forwarded to the proxy on fallback

```ts
interface DirectFetchCandidate {
    canHandle: (url: string) => boolean;
    tryGetSpec: (url: string) => DirectFetchSpec | null;
}
```

Add new candidates here rather than hardcoding carve-out handlers.

### HTTP identity (`src/lib/http.ts`)

Central constants for external API identification:

```ts
export const USER_AGENT = 'MachineLearner/1.0 (mailto:crossref@chrislansdown.com)';
export const CROSSREF_MAILTO = 'crossref@chrislansdown.com';
export const UNPAYWALL_EMAIL = 'machinelearner@findforge.app';
```

Use these instead of hardcoding emails in tool files. The browser forbids setting `User-Agent` via `fetch()` — the constant is forwarded to the proxy worker, which applies it to outgoing requests.

### Sync ignore prefixes

The cloud sync engine ignores paths under `/research/` that start with any prefix in `SYNC_IGNORE_PREFIXES` (defined in `cloudSync.ts`):

```ts
const SYNC_IGNORE_PREFIXES = [
    'preferences/syncManifest',
    'sync/',
    'doc-cache/',
];
```

Both the diff walk (`computeSyncActions`) and the complete re-sync (`syncResetThenPull`) use the shared `isPathIgnored()` helper. Add new local-only prefixes here.

### CSP updates when adding APIs

The `connect-src` directive in `vite.config.ts` must include every domain the app fetches from directly (not via the proxy). Current set:

```
https://openrouter.ai
https://*.clerk.accounts.dev https://*.clerk.com
https://*.wikipedia.org
https://eutils.ncbi.nlm.nih.gov
https://www.newadvent.org
https://api.crossref.org
```

Proxy worker endpoints (`/web-proxy`, `/storage`, `/openrouter-proxy`, `/users-worker`) are Vite-proxied in dev and resolve to worker URLs in production — covered by `'self'` in dev and by the full worker URL in production config.

## Missing / Notable
- No CI workflows, no pre-commit hooks, no monorepo tooling.
- `TODO.txt` exists but is not a task tracker for agents.
- Run `npm install` after pulling to install new dependencies (e.g. `@clerk/clerk-js`).
- Run `cleanup_google_drive.sh` to remove stale Google Drive files from disk.
