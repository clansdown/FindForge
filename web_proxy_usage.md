# FindForge Web Proxy

A Cloudflare Worker that proxies HTTP GET requests to arbitrary URLs on behalf of authenticated users. Used to bypass CORS restrictions when fetching reference documents from third-party APIs.

## API Endpoint

| Environment | URL |
|---|---|---|
| Development | `http://localhost:8787` |
| Production | `https://findforge-web-proxy.chris-f57.workers.dev` |

## Local Development

1. **Start the dev server**:
   ```bash
   cd findforge-web-proxy
   npm run dev
   ```
   This runs `wrangler dev` which starts the worker at `http://localhost:8787`.

2. **Set local secrets**: Copy the example file and fill in a valid Clerk secret key:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   Edit `.dev.vars`:
   ```
   CLERK_SECRET_KEY=sk_test_your_local_clerk_secret
   ```

3. **Make requests** to `http://localhost:8787` instead of the production URL.

Client code should use a configurable base URL (environment variable, build flag, etc.) to switch between `http://localhost:8787` and `https://findforge-web-proxy.chris-f57.workers.dev`.

## Authentication

All requests require a valid Clerk session token in the `Authorization` header:

```
Authorization: Bearer <clerk-session-token>
```

## Rate Limits

Per-user limits:

| Window | Limit |
|---|---|
| Per minute | 256 requests |
| Per hour | 8,192 requests |
| Per day | 10,000 requests |

Rate-limited requests return `429` with a `Retry-After` header.

## Making a Request

`POST /` with a JSON body:

```json
{
  "url": "https://api.example.com/documents/reference.pdf"
}
```

### Example

```bash
# Replace BASE_URL with your environment:
#   Development: http://localhost:8787
#   Production:  https://findforge-web-proxy.chris-f57.workers.dev
curl -X POST $BASE_URL/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://jsonplaceholder.typicode.com/posts/1"}'
```

### Response

The worker forwards the target's response:
- **Status code**: same as the target's status
- **Forwarded headers**: `Content-Type`, `Content-Length`, `Cache-Control`, `ETag`, `Last-Modified`, `Date`, `Expires`, `Vary`
- **Body**: raw response body (streamed, no buffering)

All responses include CORS headers so browsers can read the result.

## Error Responses

All errors return JSON with a `code` and `error` message.

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_json` | Request body is not valid JSON |
| 400 | `invalid_url` | Missing, malformed, or unsafe URL |
| 401 | `token_missing` | No Authorization header |
| 401 | `token_invalid` | Malformed or invalid token |
| 401 | `token_expired` | Token has expired (client should refresh) |
| 401 | `token_not_active_yet` | Token not yet valid |
| 401 | `auth_failed` | Generic authentication failure |
| 405 | `method_not_allowed` | Only POST is accepted |
| 404 | `not_found` | Path other than `/` |
| 429 | `rate_limited` | Rate limit exceeded (check `Retry-After`) |
| 502 | `fetch_failed` | Could not reach the target URL |
| 503 | `rate_limiter_unavailable` | Rate limiter temporarily unavailable |
| 500 | `internal_error` | Unexpected server error |

### Token Expired

When you get `token_expired` (status 401), the response body includes `retry: true`:

```json
{
  "error": "Authentication token has expired",
  "code": "token_expired",
  "retry": true
}
```

Refresh the session token via Clerk and retry the request.

## Security

- **Authentication required**: Every request must include a valid Clerk Bearer token.
- **HTTPS only**: The target URL must use `http://` or `https://`.
- **Private IP blocking**: Requests to `localhost`, `127.0.0.1`, `::1`, or private IPv4 ranges (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`) are rejected.
- **No credentials in URLs**: URLs with embedded `user:password@` are rejected.
- **Rate limiting**: Per-user Durable Object with minute, hour, and day windows.
- **Header filtering**: Only whitelisted response headers are forwarded to the client.
- **Fetch timeout**: Upstream requests time out after 10 seconds.
