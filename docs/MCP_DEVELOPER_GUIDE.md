# A2A Developer Guide for Juli Platform

A comprehensive guide to building Agent-to-Agent (A2A) protocol agents for Juli - the AI platform used by thousands of users worldwide.

**Important**: This project has transitioned from REST-based MCP endpoints to the A2A JSON-RPC protocol. All interactions now use JSON-RPC 2.0 format.

## Table of Contents
- [Overview](#overview)
- [Juli Authentication System](#juli-authentication-system)
- [A2A Protocol Specification](#a2a-protocol-specification)
- [Building Your A2A Agent](#building-your-a2a-agent)
- [Tool Design Best Practices](#tool-design-best-practices)
- [Testing and Deployment](#testing-and-deployment)

## Overview

### What is Juli?

Juli is an AI platform that orchestrates multiple AI models and tools to help users accomplish complex tasks. A2A agents extend Juli's capabilities by providing specialized tools that integrate with external services.

### What is A2A?

Agent-to-Agent (A2A) protocol is a JSON-RPC 2.0 based standard for AI systems to interact with external tools and services. It defines:
- How tools are discovered and described
- How requests and responses are formatted
- How authentication and context are handled
- How approvals and safety checks work

### Why Build for Juli?

- **Reach thousands of users** - Juli's growing user base needs quality tools
- **Monetization** - Premium A2A agents can generate revenue
- **Simple integration** - Juli handles all the complex infrastructure
- **Focus on your expertise** - Build tools in domains you know best

## Juli Authentication System

### How Juli Handles Credentials

Juli implements a secure, user-friendly authentication system that makes using A2A agents seamless:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Juli Client   │────▶│  Juli Platform  │────▶│   A2A Agent     │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                         │
        │                       │                         │
    User provides           Stores & manages         Receives creds
    credentials once        credentials              per request
```

### Setup Flow (Hosted Auth)

Important: Users authenticate via Nylas Hosted Auth. The agent keeps `NYLAS_API_KEY` in env and returns a `grant_id`. A2A agents are stateless and never store per-user credentials.

When a user first installs your A2A agent:

```typescript
// 1) Juli checks if setup is needed
GET /setup/status
Response: { "needs_setup": true, "connect_url": "/setup/connect-url" }

// 2) Juli fetches the Hosted Auth URL
GET /setup/connect-url?redirect_uri=https://yourapp.com/api/nylas-email/callback
Response: { "url": "https://api.us.nylas.com/v3/connect/auth?..." }

// 3) User completes provider login; callback returns the grant
GET /api/nylas-email/callback?code=...
Response: { "success": true, "grant_id": "...", "email": "user@example.com" }

// 4) Juli stores only the grant_id
// 5) Every future request includes:
Headers: { "X-User-Credential-NYLAS_GRANT_ID": "..." }
```

### Agent-to-Agent (A2A)

For inter-agent integrations, use JSON‑RPC A2A:

- Discovery: `GET /.well-known/a2a.json` (Agent Card)
- RPC endpoint: `POST /a2a/rpc` (JSON‑RPC 2.0)
- Methods:
  - `agent.card` → Agent Card
  - `agent.handshake` → `{ agent, card, server_time }`
  - `tool.execute` → params `{ tool, arguments, user_context, request_id }`
  - `tool.approve` → params `{ tool, original_arguments, action_data, user_context, request_id }`

Auth:
- Use the Agent Card `auth` scheme(s). OIDC ID token in `Authorization: Bearer <id_token>` (audience per card). Dev: optional `X-A2A-Dev-Secret`.

The server remains stateless; only `NYLAS_API_KEY` is in env. User grant is injected per-request.

### Credential acquisition (optional manifest)

Agents may publish `GET /.well-known/a2a-credentials.json` describing how Brain can obtain credentials it must inject. Example:

```json
{
  "credentials": [
    {
      "key": "EMAIL_ACCOUNT_GRANT",
      "display_name": "Email Account Grant",
      "sensitive": true,
      "flows": [
        {
          "type": "hosted_auth",
          "connect_url": "/setup/connect-url",
          "callback": "/api/nylas-email/callback",
          "provider_scopes": {
            "google": [
              "openid",
              "https://www.googleapis.com/auth/userinfo.email",
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/gmail.modify",
              "https://www.googleapis.com/auth/contacts",
              "https://www.googleapis.com/auth/contacts.readonly",
              "https://www.googleapis.com/auth/contacts.other.readonly"
            ],
            "microsoft": ["Mail.ReadWrite","Mail.Send","Contacts.Read","Contacts.Read.Shared"]
          }
        }
      ]
    }
  ]
}
```

### Request Format

All tool execution requests follow this format:

```typescript
POST /a2a/rpc (JSON-RPC 2.0)
Headers: {
  "Content-Type": "application/json",
  "X-Request-ID": "unique-request-id",
  "X-User-ID": "juli-user-id",
  "X-User-Credential-NYLAS_GRANT_ID": "uuid"
}
Body: {
  // Tool-specific parameters
  "param1": "value1",
  "param2": "value2"
}
```

### Response Format

#### Success Response
```typescript
{
  "success": true,
  "data": {}
}
```

#### Error Response
```typescript
{
  "error": "User-friendly error message",
  "error_code": "RATE_LIMIT_EXCEEDED"
}
```

#### Needs Setup Response
```typescript
{
  "needs_setup": true,
  "message": "Please complete setup to use this tool",
  "connect_url": "/setup/connect-url"
}
```

### Tool Discovery Format

```typescript
GET /.well-known/a2a.json
Response: {
  "tools": [
    {
      "name": "tool_name",
      "description": "Clear description of what this tool does",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": {
            "type": "string",
            "description": "What this parameter does"
          },
          "param2": {
            "type": "number",
            "description": "Another parameter",
            "minimum": 0,
            "maximum": 100
          }
        },
        "required": ["param1"]
      }
    }
  ]
}
```

### Context Injection

Juli can automatically inject user context into tool calls:

```typescript
// In your tool schema
"inputSchema": {
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "Message to send"
    },
    "user_name": {
      "type": "string",
      "description": "User's name",
      "x-context-injection": "user_name"  // Juli auto-fills
    },
    "user_timezone": {
      "type": "string",
      "description": "User's timezone",
      "x-context-injection": "user_timezone"
    }
  }
}
```

Available context fields:
- `user_name` - User's display name
- `user_email` - User's email address
- `user_timezone` - User's timezone (e.g., "America/New_York")
- `current_date` - Current date in user's timezone
- `current_time` - Current time in user's timezone

## Building Your A2A Agent

### Critical Design Principle: Stateless Credential Handling

A2A agents are stateless regarding user credentials. Extract credentials from headers per request and never store them.

```typescript
function handleRequest(req) {
  const credentials = extractCredentials(req.headers);
  const client = new ServiceClient(process.env.NYLAS_API_KEY);
  return client.doWork(credentials.nylas_grant_id);
}
```

**Why Stateless?**
- **Security**: No credential leaks if server is compromised
- **Scalability**: Servers can be scaled horizontally without session affinity
- **Reliability**: Server restarts don't affect users
- **Multi-tenancy**: One server instance serves all users safely

### Server Architecture

```typescript
import express from 'express';
import { z } from 'zod';

class A2AAgent {
  private app: express.Application;
  private tools: Map<string, Tool>;
  
  constructor() {
    this.app = express();
    this.tools = new Map();
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(this.logRequests);
    this.app.use(this.extractCredentials);
  }
  
  private extractCredentials(req, res, next) {
    req.credentials = {};
    
    // Extract all X-User-Credential-* headers
    Object.keys(req.headers).forEach(header => {
      if (header.startsWith('x-user-credential-')) {
        const credName = header.replace('x-user-credential-', '');
        req.credentials[credName] = req.headers[header];
      }
    });
    
    next();
  }
  
  private setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', version: '1.0.0' });
    });
    
    this.app.get('/setup/status', (req, res) => {
      const needsSetup = !this.hasRequiredCredentials(req.credentials);
      res.json({
        needs_setup: needsSetup,
        auth_type: 'api_key',
        service_name: 'Your Service',
        setup_tool: 'setup_service'
      });
    });
    
    // Discovery endpoint - replaced by A2A Agent Card at /.well-known/a2a.json
    // Legacy endpoint removed - tools are now exposed via A2A capabilities
    
    // Tool execution - replaced by A2A JSON-RPC at /a2a/rpc
    // Legacy REST endpoint removed - use JSON-RPC 'tool.execute' method
    
    // A2A JSON-RPC endpoint
    this.app.post('/a2a/rpc', async (req, res) => {
      // Authenticate agent (OIDC or shared secret)
      const agent = await this.authenticateAgent(req);
      if (!agent) {
        return res.status(401).json({ 
          jsonrpc: '2.0', 
          id: null, 
          error: { code: 401, message: 'unauthorized_agent' } 
        });
      }
      
      // Handle JSON-RPC request
      const { method, params, id } = req.body;
      try {
        const { toolName } = params || {};
        const tool = this.tools.get(toolName);
        
        if (!tool) {
          return res.status(404).json({
            error: `Tool '${toolName}' not found`
          });
        }
        
        // Check credentials
        if (!this.hasRequiredCredentials(req.credentials)) {
          return res.json({
            needs_setup: true,
            message: 'Please complete setup first',
            setup_tool: 'setup_service'
          });
        }
        
        // Validate input
        const validatedInput = tool.validateInput(req.body);
        
        // Execute tool
        const result = await tool.execute(validatedInput, req.credentials);
        
        res.json(result);
      } catch (error) {
        console.error(`Error in tool ${req.params.toolName}:`, error);
        res.status(500).json({
          error: 'An error occurred processing your request',
          error_code: 'INTERNAL_ERROR'
        });
      }
    });
  }
}
```

### Tool Implementation Pattern

```typescript
abstract class Tool {
  constructor(
    public name: string,
    public description: string
  ) {}
  
  abstract getSchema(): object;
  abstract validateInput(input: any): any;
  abstract execute(input: any, credentials: any): Promise<any>;
}

class ExampleTool extends Tool {
  constructor() {
    super(
      'example_tool',
      'Does something useful with natural language'
    );
  }
  
  getSchema() {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you want'
        },
        options: {
          type: 'object',
          properties: {
            include_details: {
              type: 'boolean',
              default: false
            }
          }
        }
      },
      required: ['query']
    };
  }
  
  validateInput(input: any) {
    // Use zod or another validator
    const schema = z.object({
      query: z.string().min(1),
      options: z.object({
        include_details: z.boolean().optional()
      }).optional()
    });
    
    return schema.parse(input);
  }
  
  async execute(input: any, credentials: any) {
    // Create service client with credentials
    const client = new YourServiceClient({
      apiKey: credentials.api_key
    });
    
    try {
      // Process natural language
      const intent = await this.understandQuery(input.query);
      
      // Execute action
      const result = await client.doSomething(intent);
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      if (error.code === 'RATE_LIMIT') {
        return {
          error: 'Rate limit exceeded. Please try again later.',
          error_code: 'RATE_LIMIT_EXCEEDED',
          details: {
            retry_after: 60
          }
        };
      }
      throw error;
    }
  }
}
```

### Stateless Design Principles

1. **No Session State**
   ```typescript
   // ❌ Bad: Storing user state
   const userSessions = new Map();
   
   // ✅ Good: Everything in request
   function handleRequest(req) {
     const credentials = req.credentials;
     const client = createClient(credentials);
     return client.doWork();
   }
   ```

2. **Request-Scoped Clients**
   ```typescript
   // ❌ Bad: Global client
   const client = new ServiceClient(process.env.API_KEY);
   
   // ✅ Good: Per-request client
   function handleRequest(req) {
     const client = new ServiceClient(req.credentials.api_key);
     return client.doWork();
   }
   ```

3. **Horizontal Scaling Ready**
   ```typescript
   // Your server should work with multiple instances
   // No in-memory caches for user data
   // No local file storage for user content
   // Use external services for persistence if needed
   ```

## Tool Design Best Practices

### 1. Natural Language First

```typescript
// ❌ Bad: Technical parameters
{
  name: "execute_query",
  parameters: {
    sql: "SELECT * FROM users WHERE...",
    database: "production",
    timeout: 30000
  }
}

// ✅ Good: Natural language
{
  name: "find_data",
  parameters: {
    query: "Show me active users from last week",
    include_details: true
  }
}
```

### 2. Progressive Disclosure

```typescript
// Start simple
{
  name: "analyze_data",
  parameters: {
    query: "What are my top selling products?"
  }
}

// Allow advanced options
{
  name: "analyze_data",
  parameters: {
    query: "What are my top selling products?",
    options: {
      time_range: "last_quarter",
      group_by: "category",
      include_trends: true
    }
  }
}
```

### 3. Clear Descriptions

```typescript
{
  name: "manage_email",
  description: "Send, reply, forward, or draft emails using natural language. Handles all email composition intelligently.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["send", "reply", "forward", "draft"],
        description: "What to do with the email"
      },
      query: {
        type: "string",
        description: "Natural language description. Examples: 'reply to Sarah thanking her for the proposal', 'forward the AWS alerts to the dev team with a summary'"
      }
    }
  }
}
```

### 4. Error Messages Users Understand

```typescript
// ❌ Bad: Technical errors
{
  error: "Connection timeout: ETIMEDOUT 192.168.1.1:5432"
}

// ✅ Good: User-friendly errors
{
  error: "Unable to connect to your database. Please check if your database is online and accessible.",
  error_code: "DATABASE_UNAVAILABLE",
  details: {
    suggestion: "Try again in a few moments or contact your database administrator"
  }
}
```

### 5. Approval Flow for Sensitive Actions

```typescript
async function deleteData(params, credentials) {
  // Calculate impact
  const itemsToDelete = await findItems(params.filter);
  
  // Request approval for large deletions
  if (itemsToDelete.length > 10) {
    return {
      needs_approval: true,
      action_type: 'bulk_delete',
      action_data: {
        filter: params.filter,
        ids: itemsToDelete.map(i => i.id)
      },
      preview: {
        summary: `Delete ${itemsToDelete.length} items`,
        details: {
          oldest_item: itemsToDelete[0].created_at,
          newest_item: itemsToDelete[itemsToDelete.length - 1].created_at
        },
        risks: ['This action cannot be undone']
      }
    };
  }
  
  // Execute for small deletions
  await performDelete(itemsToDelete);
  return {
    success: true,
    message: `Deleted ${itemsToDelete.length} items`
  };
}
```

## Testing and Deployment

### Testing Your MCP

```typescript
// Test the A2A flow
describe('A2A MCP Server', () => {
  it('should handle agent discovery and authentication', async () => {
    // 1. Discovery via well-known endpoint
    const discovery = await fetch('/.well-known/a2a.json');
    expect(discovery.body.agent_id).toBe('inbox-mcp');
    expect(discovery.body.rpc.endpoint).toBe('/a2a/rpc');
    
    // 2. Get agent card via JSON-RPC
    const cardResponse = await fetch('/a2a/rpc', {
      method: 'POST',
      headers: { 'X-A2A-Dev-Secret': 'test-secret' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.card',
        params: {}
      }
    });
    expect(cardResponse.body.result.agent_id).toBe('inbox-mcp');
  });
  
  it('should execute tools via JSON-RPC', async () => {
    const response = await fetch('/a2a/rpc', {
      method: 'POST',
      headers: {
        'X-A2A-Dev-Secret': 'test-secret'
      },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tool.execute',
        params: {
          tool: 'manage_email',
          arguments: { action: 'send', query: 'test email' },
          user_context: {
            credentials: { EMAIL_ACCOUNT_GRANT: 'user_grant_id' }
          }
        }
      }
    });
    
    expect(response.body.result).toBeDefined();
    expect(response.body.error).toBeUndefined();
  });
});
```

### Docker Deployment

```dockerfile
# Multi-stage build for efficiency
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Copy built app
COPY --from=builder /app/dist ./dist

# Run as non-root
USER node

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
```

### Production Checklist

- [ ] Comprehensive error handling
- [ ] Rate limiting implementation
- [ ] Request validation
- [ ] Secure credential handling
- [ ] Health check endpoint
- [ ] Structured logging
- [ ] Monitoring and metrics
- [ ] Graceful shutdown
- [ ] Documentation complete
- [ ] Security review passed

## Publishing to Juli

### Requirements

1. **Functional Requirements**
   - All tools must have clear descriptions
   - Natural language processing required
   - Proper error handling
   - Setup flow must be user-friendly

2. **Technical Requirements**
   - HTTP-only server (no WebSocket)
   - Stateless operation
   - Docker support recommended
   - Health check endpoint required

3. **Documentation Requirements**
   - README with clear examples
   - API documentation
   - Setup instructions
   - Troubleshooting guide

### Submission Process

1. Test thoroughly with multiple accounts
3. Submit via Juli Developer Portal
4. Respond to review feedback
5. Launch to thousands of users!

## Common Patterns

### Multi-Service Integration
```typescript
// When your MCP needs multiple API keys
headers: {
  'X-User-Credential-OPENAI_KEY': 'sk-...',
  'X-User-Credential-SERVICE_KEY': 'svc_...',
  'X-User-Credential-WORKSPACE': 'ws_123'
}
```

### Webhook Support
```typescript
// Register webhooks with callback URL
const callbackUrl = `https://juli-webhooks.com/mcp/${req.userId}/${toolName}`;
await client.registerWebhook(callbackUrl);
```

### Batch Operations
```typescript
// Process multiple items efficiently
{
  name: "bulk_process",
  parameters: {
    items: ["item1", "item2", "item3"],
    operation: "analyze"
  }
}
```

## Conclusion

Building MCP servers for Juli opens your tools to thousands of users who need specialized capabilities. Focus on:

1. **User Experience** - Natural language, clear errors, smooth setup
2. **Reliability** - Proper error handling, stateless design, monitoring
3. **Security** - Never store credentials, validate all input
4. **Performance** - Efficient operations, proper timeouts, scaling ready

Your MCP server will help Juli users be more productive and accomplish amazing things. Welcome to the Juli developer community!

## Resources

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Juli Developer Portal](https://juli-ai.com/developers)
- [Support](ignacio@juli-ai.com)