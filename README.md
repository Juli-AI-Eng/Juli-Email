# Inbox Email Assistant

An A2A (Agent-to-Agent) JSON-RPC agent for Juli that provides AI-powered email management. This is one of the default apps every Juli user gets when they sign up.

## What it does

- Send, reply, and manage emails with natural language
- Find and analyze emails intelligently  
- Organize your inbox with AI-powered rules
- Get insights and summaries about your email patterns

## For Juli Users

Inbox MCP is pre-installed with your Juli account. Click Connect in Juli, sign in to your email provider, and start using natural language commands like:
- "Reply to Sarah about the meeting"
- "Find important emails from this week"
- "Clean up my inbox"

Notes:
- You do not need a Nylas account. Authentication is handled via Nylas Hosted Auth.
- Juli stores only your grant_id and injects it automatically when calling the tools.

## For A2A Developers

This repository serves as a reference implementation for building A2A agents for Juli. It demonstrates:
- HTTP-based stateless architecture
- Juli's credential injection system
- Natural language tool design
- Approval flows for sensitive actions

See [docs/MCP_DEVELOPER_GUIDE.md](docs/MCP_DEVELOPER_GUIDE.md) for the complete A2A developer guide.

### Agent Quickstart (A2A JSON‑RPC)

1) Discover
- GET `/.well-known/a2a.json` → Agent Card (auth, approvals, context, capabilities, rpc)

2) Authenticate (agent→agent)
- Send OIDC ID token: `Authorization: Bearer <ID_TOKEN>` (audience/issuers from the card)
- Optional dev-only header: `X-A2A-Dev-Secret`

3) Obtain user credential (EMAIL_ACCOUNT_GRANT)
- GET `/.well-known/a2a-credentials.json` → pick a flow (hosted_auth)
- Open `connect_url` in a browser, complete provider login, receive `grant_id` from callback
- Store `grant_id` as `EMAIL_ACCOUNT_GRANT`

4) Execute a tool
```bash
curl -sS -H "Authorization: Bearer $ID_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"1","method":"tool.execute",
    "params":{
      "tool":"manage_email",
      "arguments":{ "action":"send", "query":"email test@example.com about tomorrow" },
      "user_context":{ "credentials": { "EMAIL_ACCOUNT_GRANT":"<grant>" } },
      "request_id":"<uuid>"
    }
  }' http://localhost:3000/a2a/rpc
```

5) Approve when required
```bash
curl -sS -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":"2","method":"tool.approve",
    "params":{
      "tool":"manage_email",
      "original_arguments":{ "action":"send", "query":"..." },
      "action_data":{ /* from preview */ },
      "user_context":{ "credentials": { "EMAIL_ACCOUNT_GRANT":"<grant>" } },
      "request_id":"<uuid>"
    }
  }' http://localhost:3000/a2a/rpc
```

## Quick Start

```bash
# Install dependencies
npm install

# Build and run
npm run build
npm start

# Or use Docker
docker-compose up
```

### Required environment variables

Set the following for the server (no user API keys are injected):

```
OPENAI_API_KEY=sk-...
NYLAS_API_KEY=nyk_...
NYLAS_CLIENT_ID=...
NYLAS_CALLBACK_URI=http://localhost:3000/api/nylas-email/callback
# Optional (defaults to US):
NYLAS_API_URI=https://api.us.nylas.com
```

### Connect your email (Hosted Auth)

1) Check if setup is needed
```
GET /setup/status
→ { "needs_setup": true, "connect_url": "/setup/connect-url" }
```

2) Get the Hosted Auth URL
```
GET /setup/connect-url?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fnylas-email%2Fcallback
→ { "url": "https://api.us.nylas.com/v3/connect/auth?..." }
```
Open the returned URL and complete the provider login.

3) Callback returns your grant
```
GET /api/nylas-email/callback?code=...
→ { "success": true, "grant_id": "...", "email": "user@example.com" }
```
Juli stores the grant_id and injects it as `X-User-Credential-NYLAS_GRANT_ID` on every tool request.

## Documentation

- [A2A Developer Guide](docs/MCP_DEVELOPER_GUIDE.md) - Build A2A agents for Juli
- [Tools Documentation](docs/TOOLS_DOCUMENTATION.md) - All available tools
- [Approval System](docs/APPROVAL_SYSTEM_GUIDE.md) - How approvals work
- [Docker Guide](docs/DOCKER_GUIDE.md) - Deployment instructions

## License

MIT - See [LICENSE](LICENSE)