### A2A Developer Quickstart

This agent exposes a JSON-RPC A2A interface for Juli Brain and other agents.

1) Configure env

Create `.env` at repo root using these keys:

```
PORT=3000
NODE_ENV=development
OPENAI_API_KEY=
OPENAI_REASONING_EFFORT=minimal
OPENAI_VERBOSITY=low
NYLAS_API_KEY=
NYLAS_CLIENT_ID=
NYLAS_CALLBACK_URI=
NYLAS_API_URI=
A2A_AUDIENCE=
A2A_DEV_SHARED_SECRET=test-secret
TEST_EMAIL_ADDRESS=
```

2) Run

```
npm i
npm run dev
```

3) Discovery

- GET `/.well-known/a2a.json` to read the Agent Card and cache capabilities.
- Optionally GET `/.well-known/a2a-credentials.json` to learn how to acquire credentials.

4) Auth

- Production: `Authorization: Bearer <OIDC ID token>` with audience = `A2A_AUDIENCE` (or base URL).
- Dev: include `X-A2A-Dev-Secret: <shared secret>`.

5) Credentials

- Store the user’s Nylas `grant_id` as `EMAIL_ACCOUNT_GRANT` and inject in `user_context.credentials`.

6) Execute and Approve

Request:

```json
{ "jsonrpc":"2.0","id":"1","method":"tool.execute","params":{ "tool":"manage_email","arguments":{ "action":"send","query":"say hi" },"user_context":{"credentials":{"EMAIL_ACCOUNT_GRANT":"<uuid>"}},"request_id":"<uuid>" } }
```

Approval:

```json
{ "jsonrpc":"2.0","id":"2","method":"tool.approve","params":{ "tool":"manage_email","original_arguments":{ "action":"send","query":"say hi" },"action_data":{ },"user_context":{"credentials":{"EMAIL_ACCOUNT_GRANT":"<uuid>"}},"request_id":"<uuid>" } }
```

7) Status & Connect URL

- `GET /setup/status` for setup state and connect URL
- `GET /setup/connect-url` for a Nylas Hosted Auth URL (JSON)

See `docs/A2A_HANDOFF.md` for full details.


