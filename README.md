# Inbox MCP

An example MCP (Model Context Protocol) server for Juli that provides AI-powered email management. This is one of the default apps every Juli user gets when they sign up.

## What it does

- Send, reply, and manage emails with natural language
- Find and analyze emails intelligently  
- Organize your inbox with AI-powered rules
- Get insights and summaries about your email patterns

## For Juli Users

Inbox MCP is pre-installed with your Juli account. Just connect your email via Nylas and start using natural language commands like:
- "Reply to Sarah about the meeting"
- "Find important emails from this week"
- "Clean up my inbox"

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

## Documentation

- [MCP Developer Guide](docs/MCP_DEVELOPER_GUIDE.md) - Build MCP servers for Juli
- [Tools Documentation](docs/TOOLS_DOCUMENTATION.md) - All available tools
- [Approval System](docs/APPROVAL_SYSTEM_GUIDE.md) - How approvals work
- [Docker Guide](docs/DOCKER_GUIDE.md) - Deployment instructions

## License

MIT - See [LICENSE](LICENSE)