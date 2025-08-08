# Inbox MCP

An example MCP (Model Context Protocol) server for Juli that provides AI-powered email management. This is one of the default apps every Juli user gets when they sign up.

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

## For MCP Developers

This repository serves as a reference implementation for building MCP servers for Juli. It demonstrates:
- HTTP-based stateless architecture
- Juli's credential injection system
- Natural language tool design
- Approval flows for sensitive actions

See [docs/MCP_DEVELOPER_GUIDE.md](docs/MCP_DEVELOPER_GUIDE.md) for the complete guide.

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
GET /mcp/needs-setup
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

- [MCP Developer Guide](docs/MCP_DEVELOPER_GUIDE.md) - Build MCP servers for Juli
- [Tools Documentation](docs/TOOLS_DOCUMENTATION.md) - All available tools
- [Approval System](docs/APPROVAL_SYSTEM_GUIDE.md) - How approvals work
- [Docker Guide](docs/DOCKER_GUIDE.md) - Deployment instructions

## License

MIT - See [LICENSE](LICENSE)