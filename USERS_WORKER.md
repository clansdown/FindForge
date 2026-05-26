# FindForge Users Worker

Manages per-user state (credits, permissions, usage) backed by a Durable Object. Other Workers query it via cross-worker DO bindings (RPC). **The SPA uses the HTTP endpoints below — RPC is only available to other Cloudflare Workers.**

## Endpoint

```
https://findforge-users.chris-f57.workers.dev
```

## Authentication

All requests require a valid Clerk session token:

```
Authorization: Bearer <clerk_session_token>
```

Returns `401` with code `token_missing`, `token_expired`, or `token_invalid` if authentication fails.

---

## Endpoints (for the SPA)

All endpoints require authentication. Preflight `OPTIONS` requests return `204` with CORS headers.

### GET /credits

Returns the user's current credit balance.

```
GET /credits
Authorization: Bearer <clerk_session_token>
```

**Response (200):**
```json
{ "credits": 42 }
```

---

### POST /credits/deduct

Deducts a positive amount from the user's credit balance.

```
POST /credits/deduct
Authorization: Bearer <clerk_session_token>
Content-Type: application/json

{ "amount": 50 }
```

**Success (200):**
```json
{ "success": true, "remaining": 150 }
```

**Insufficient credits (402):**
```json
{ "error": "Insufficient credits", "code": "insufficient_credits", "remaining": 10 }
```

Negative amounts are not accepted via HTTP (used internally for refunds via RPC — see `deductCredits(-refund)` calls from the OpenRouter proxy).

---

### GET /permissions

Returns the user's full permissions object.

```
GET /permissions
Authorization: Bearer <clerk_session_token>
```

**Response (200):**
```json
{
  "permissions": {
    "paid_models": false,
    "image_generation": false
  }
}
```

---

### GET /permissions/:name

Checks a single permission by name.

```
GET /permissions/paid_models
Authorization: Bearer <clerk_session_token>
```

**Response (200):**
```json
{ "allowed": false }
```

Returns `true` if the permission exists and is `true`, otherwise `false`.

---

### POST /usage

Records usage metrics (requests and tokens). Increments counters rather than setting them.

```
POST /usage
Authorization: Bearer <clerk_session_token>
Content-Type: application/json

{ "requests": 1, "tokens": 450 }
```

Both fields are optional and default to `0`.

**Response (200):**
```json
{ "success": true }
```

---

## Default State

New users (first DO access) start with:

| Field | Default |
|---|---|
| `credits` | `0` |
| `permissions.paid_models` | `false` |
| `permissions.image_generation` | `false` |
| `usage.requests` | `0` |
| `usage.tokens` | `0` |

---

## Error Codes

All errors return JSON with `error` and `code` fields:

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid_amount` | `amount` is not a positive number |
| 401 | `token_missing` | No `Authorization` header |
| 401 | `token_invalid` | Malformed or invalid token |
| 401 | `token_expired` | Session token has expired (`retry: true` in body) |
| 401 | `token_not_active_yet` | Token is not yet valid |
| 401 | `auth_failed` | Generic authentication failure |
| 402 | `insufficient_credits` | Balance too low for the requested deduction (`remaining` in body) |
| 404 | `not_found` | Unknown path or method |
| 500 | `internal_error` | Unhandled server error |

---

## CORS

| Header | Value |
|---|---|
| `Access-Control-Allow-Origin` | `*` |
| `Access-Control-Allow-Methods` | `GET, POST, OPTIONS` |
| `Access-Control-Allow-Headers` | `Authorization, Content-Type` |
| `Access-Control-Max-Age` | `86400` |

Preflight `OPTIONS` returns `204` with these headers.

---

## Cross-Worker RPC (internal — not available to the SPA)

Other Cloudflare Workers (e.g. `findforge-openrouter`) communicate with the `UserManager` Durable Object directly via a `script_name` binding in `wrangler.jsonc`. This is an internal Cloudflare mechanism and **cannot be used from the browser or the SPA**.

The SPA must use the HTTP endpoints listed above instead.

Available RPC methods (worker-to-worker only):

| Method | Returns | Used by |
|---|---|---|
| `getCredits()` | `number` | OpenRouter proxy |
| `deductCredits(amount)` | `{ success, remaining }` | OpenRouter proxy (deduct + refund) |
| `getPermissions()` | `{ paid_models, image_generation }` | OpenRouter proxy |
| `hasPermission(name)` | `boolean` | OpenRouter proxy |
| `recordUsage(requests, tokens)` | `void` | OpenRouter proxy |

RPC calls bypass the HTTP layer and authentication entirely — the caller is trusted via `script_name: "findforge-users"`.

---

## Key Behaviors

1. **State is lazily created** — first access to a user's DO initializes them with `DEFAULT_STATE`. No migration or seeding needed.
2. **Credits can go negative** — `deductCredits` with a negative amount adds credits (used for refunds). Only positive deductions check sufficiency.
3. **Permissions are a flat map** — `hasPermission(name)` looks up any key. Adding new permissions to the state shape requires a code change and DO migration.
4. **Usage is additive** — `recordUsage` increments existing counters.
