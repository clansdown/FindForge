# FindForge OpenRouter Proxy

A Cloudflare Worker that proxies `/v1/chat/completions` requests to OpenRouter with Clerk authentication, per-user rate limiting, credit enforcement, and separate free/paid API keys.

## Endpoint

```
POST https://findforge-openrouter.chris-f57.workers.dev/chat/completions
```

Only `POST /chat/completions` is supported. Any other path or method returns `404`.

## Authentication

All requests require a valid Clerk session token in the `Authorization` header:

```
Authorization: Bearer <clerk_session_token>
```

Returns `401` with code `token_missing`, `token_expired`, or `token_invalid` if authentication fails.

## Request Body

The body is a standard OpenRouter `/v1/chat/completions` payload. Only these fields are inspected by the proxy:

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | OpenRouter model ID; may include `:free` suffix |
| `stream` | boolean | no | `true` enables SSE streaming |
| `max_tokens` | number | no | Defaults to `4096` if omitted |

All other fields are forwarded verbatim to OpenRouter.

## Credit & Model Enforcement

The proxy checks the user's credit balance from the `findforge-users` worker before routing the request. The behavior depends on both credits and model type:

### Free models

A model is considered **free** if either:
- It ends with the `:free` qualifier (e.g. `openai/gpt-3.5-turbo:free`)
- It appears in OpenRouter's free models list (KV cache refreshed hourly from `openrouter.ai/api/v1/models`)

Free models always use the `OPENROUTER_FREE_API_KEY`. No credits are deducted.

### Paid models

All other models are **paid** and use the `OPENROUTER_PAID_API_KEY`.

**User has credits (> 0):**
- Paid models are allowed (subject to `paid_models` permission check)
- An estimated maximum cost is deducted upfront
- After the response, the difference between estimated and actual cost is refunded
- For streaming responses, usage is captured via a TransformStream on the final SSE chunk

**User has no credits (<= 0):**
- Paid models are **rejected** with `402 insufficient_credits`
- Free models still work — the user can use free models without credits

### Permission checks

- **Image generation models** (`openai/dall-e-3`, `stabilityai/stable-diffusion-xl`, `black-forest-labs/flux`, etc.) require the `image_generation` permission. Rejected with `403 permission_denied` if not granted.
- **Paid models** require the `paid_models` permission. Rejected with `403 permission_denied` if not granted.

## Rate Limits

Per-user, enforced by a Durable Object (SQLite-backed sliding windows):

| Window | Limit |
|---|---|
| Per minute | 128 requests |
| Per hour | 2,048 requests |
| Per day | 8,192 requests |

Exceeding any window returns `429 rate_limited` with a `Retry-After` header.

## Error Codes

All errors return JSON with `error` and `code` fields:

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid_json` | Request body is not valid JSON |
| 400 | `missing_model` | `model` field is missing or not a string |
| 401 | `token_missing` | No `Authorization` header |
| 401 | `token_invalid` | Malformed or invalid token |
| 401 | `token_expired` | Session token has expired (`retry: true` in body) |
| 401 | `token_not_active_yet` | Token is not yet valid |
| 401 | `auth_failed` | Generic authentication failure |
| 402 | `insufficient_credits` | Not enough credits for a paid model (use a free model or add credits) |
| 403 | `permission_denied` | User lacks a required permission (paid_models, image_generation) |
| 404 | `not_found` | Wrong method or path |
| 429 | `rate_limited` | Rate limit exceeded (`retryAfter` in body + `Retry-After` header) |
| 502 | `upstream_error` | Failed to reach OpenRouter |
| 503 | `rate_limiter_unavailable` | Rate limiter DO temporarily unavailable |
| 500 | `internal_error` | Unhandled server error |

## Checking Credit Balance

The `findforge-users` worker exposes the user's current credit balance:

```
GET https://findforge-users.chris-f57.workers.dev/credits
Authorization: Bearer <clerk_session_token>
```

Response: `{ "credits": <number> }`

## CORS

All responses include CORS headers. Preflight `OPTIONS` requests are handled automatically.

## Key Behaviors for the Agent to Remember

1. **The `:free` suffix is passed through to OpenRouter** — it's a valid OpenRouter provider selector. Do not strip it.
2. **Free models bypass all credit/permission logic** except the image generation permission check.
3. **Paid model cost is over-deducted then refunded** — the frontend should not show the user's credit balance during an active request, as it temporarily reflects the over-estimate.
4. **Streaming responses for paid models have credit tracked in the background** via `ctx.waitUntil`. The refund happens after the stream ends.
5. **Free model list is cached in KV and refreshed hourly** via cron at `0 * * * *`. A new free model may take up to an hour to be recognized.
6. **The `findforge-users` worker must be deployed first** as the OpenRouter proxy depends on its `UserManager` Durable Object via cross-worker binding.
