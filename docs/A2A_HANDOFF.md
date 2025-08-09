# Juli Email A2A Integration Handoff

Audience: Juli Brain team

## Summary
- Use JSON-RPC A2A as the interface between Juli Brain and this agent.
- Keep connector model (server env: `NYLAS_API_KEY`, Brain injects `EMAIL_ACCOUNT_GRANT`).
- Authenticate Brain → Email using OIDC ID tokens; dev shared secret optional.

Reference: A2A protocol overview and goals are outlined here: https://github.com/a2aproject/A2A

## Discovery
- GET `/.well-known/a2a.json` → Agent Card with:
  - `agent_id`, `version`, `capabilities` (tools + JSON schemas)
  - `approvals.modes: ["stateless_preview_then_approve"]`
  - `auth`: single scheme or `{ schemes: [...] }`
  - `rpc: { endpoint: "/a2a/rpc" }`
  - `extensions.x-juli.credentials_manifest: "/.well-known/a2a-credentials.json"`

## Auth
- Production: Obtain Google OIDC ID token with audience = `A2A_AUDIENCE` (or server base URL). Send `Authorization: Bearer <id_token>`.
- Dev: send `X-A2A-Dev-Secret` when configured.

## Execute Flow (JSON-RPC)
- POST `/a2a/rpc` with:
```json
{ "jsonrpc":"2.0","id":"1","method":"tool.execute","params":{ "tool":"manage_email","arguments":{},"user_context":{"credentials":{"EMAIL_ACCOUNT_GRANT":"<uuid>"}},"request_id":"<uuid>" } }
```
- Responses:
  - Success: `{ "jsonrpc":"2.0","id":"1","result": { "request_id": "...", "result": { ... } } }`
  - Approval required: `{ "jsonrpc":"2.0","id":"1","result": { "request_id": "...", "result": { "needs_approval": true, "action_type": "send_email", "action_data": { ... }, "preview": { ... } } } }`
  - Error: `{ "jsonrpc":"2.0","id":"1","error": { "code": 401, "message": "missing_credentials" } }`

## Approve Flow (JSON-RPC)
- POST `/a2a/rpc` with:
```json
{ "jsonrpc":"2.0","id":"2","method":"tool.approve","params":{ "tool":"manage_email","original_arguments":{},"action_data":{},"user_context":{"credentials":{"EMAIL_ACCOUNT_GRANT":"<uuid>"}},"request_id":"<uuid>" } }
```
  - Response: `{ "jsonrpc":"2.0","id":"2","result": { "request_id": "...", "result": { "success": true, "message_id": "..." } } }`

## Required from Juli Brain
1) Agent auth
- Provision a Google service account able to mint OIDC ID tokens for audience = `A2A_AUDIENCE` (set to the Email base URL in env).
- Attach `Authorization: Bearer <id_token>` to all A2A requests.
- For local dev, support `X-A2A-Dev-Secret`.

2) Credential injection
- Store Nylas grant as `EMAIL_ACCOUNT_GRANT` and include it in `user_context.credentials` on each A2A call.

3) Discovery
- On agent registration or periodically, read `/.well-known/a2a.json` to cache capabilities and input schemas.

4) Approval UX
- Handle `needs_approval` by surfacing preview and safeties; call `tool.approve` with the returned `action_data`.

5) Error handling & retries
- Use JSON-RPC error object codes (HTTP 200 for application errors). Retry idempotent calls. Treat `request_id` as unique per call to prevent replay.

## Environment variables
- Server:
  - `NYLAS_API_KEY`, `NYLAS_CLIENT_ID`, `NYLAS_CALLBACK_URI`, `NYLAS_API_URI`
  - `A2A_AUDIENCE` (optional; defaults to server base URL)
  - `A2A_DEV_SHARED_SECRET` (dev only)
