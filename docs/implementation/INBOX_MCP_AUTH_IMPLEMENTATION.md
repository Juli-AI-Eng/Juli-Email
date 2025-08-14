# Inbox-MCP Authentication Implementation

## Overview

This document describes the authentication implementation for Inbox-MCP following the A2A specification. The agent uses Nylas Hosted Authentication to manage email credentials while remaining completely stateless.

## Architecture Summary

### Credential Flow
```
User → Frontend → Juli Brain → Integration Platform → IBM Gateway SQLite DB
                      ↓
                  Inbox-MCP (stateless agent)
```

**Key Points:**
- **Inbox-MCP**: Never stores credentials, completely stateless
- **Juli Brain**: Acts as middleman, forwards credentials to Integration Platform
- **Integration Platform**: Stores credentials in IBM Gateway SQLite database (mcp.db)
- **Credential Injection**: Credentials injected via headers on each request

## Nylas Hosted Authentication

### What is Hosted Auth?

Nylas Hosted Authentication abstracts the complexity of OAuth by:
1. Managing OAuth flows for multiple email providers (Google, Microsoft, etc.)
2. Handling token refresh internally
3. Returning a simple, permanent grant ID
4. Providing a unified API regardless of email provider

### Implementation Details

#### 1. Credential Manifest (`/.well-known/a2a-credentials.json`)

```json
{
  "version": "1.0",
  "credentials": [
    {
      "key": "EMAIL_ACCOUNT_GRANT",
      "display_name": "Email Account",
      "description": "Access to send and manage emails on your behalf",
      "sensitive": true,
      "required": true,
      "flows": [
        {
          "type": "hosted_auth",
          "connect_url": "/auth/connect",
          "callback_url": "/auth/callback",
          "provider": "nylas",
          "provider_scopes": {
            "google": ["https://www.googleapis.com/auth/gmail.modify"],
            "microsoft": ["https://graph.microsoft.com/Mail.ReadWrite"]
          }
        }
      ]
    }
  ]
}
```

#### 2. Connect Endpoint (`/auth/connect`)

```typescript
app.get('/auth/connect', (req: Request, res: Response) => {
  const redirectUri = req.query.redirect_uri as string || NYLAS_CALLBACK_URI;
  
  const authUrl = nylas.auth.getAuthUrl({
    clientId: NYLAS_CLIENT_ID,
    redirectUri: redirectUri,
    scope: ['email.send', 'email.modify', 'email.folders'],
    responseType: 'code',
    provider: 'detect'  // Auto-detect email provider
  });
  
  res.json({ url: authUrl });
});
```

#### 3. OAuth Callback (`/auth/callback`)

**CRITICAL UPDATE**: The callback now redirects to Juli Brain instead of returning JSON:

```typescript
app.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  
  if (!code) {
    logger.error('No authorization code received');
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    // Exchange code for grant with Nylas
    const response = await nylas.auth.exchangeCodeForToken({
      clientId: NYLAS_CLIENT_ID,
      redirectUri: NYLAS_CALLBACK_URI,
      code: code,
    });

    const { grantId, email } = response;

    // Build redirect URL with grant information
    // Juli Brain will receive this and forward to Integration Platform for storage
    const redirectUrl = new URL(JULI_BRAIN_CALLBACK_URI!);
    redirectUrl.searchParams.append('grant_id', grantId);
    redirectUrl.searchParams.append('credential_key', 'EMAIL_ACCOUNT_GRANT');
    redirectUrl.searchParams.append('agent_id', 'inbox-mcp');
    if (email) {
      redirectUrl.searchParams.append('email', email);
    }
    redirectUrl.searchParams.append('status', 'success');
    
    logger.log(`Redirecting to Juli Brain: ${redirectUrl.toString()}`);
    return res.redirect(redirectUrl.toString());
    
  } catch (error: any) {
    logger.error('OAuth callback error:', error);
    
    // Redirect to Juli Brain with error status
    const errorUrl = new URL(JULI_BRAIN_CALLBACK_URI!);
    errorUrl.searchParams.append('status', 'error');
    errorUrl.searchParams.append('error', error.message || 'Authentication failed');
    errorUrl.searchParams.append('agent_id', 'inbox-mcp');
    errorUrl.searchParams.append('credential_key', 'EMAIL_ACCOUNT_GRANT');
    
    return res.redirect(errorUrl.toString());
  }
});
```

#### 4. Environment Variables

Required in `.env`:

```bash
# Nylas Configuration
NYLAS_API_KEY=nyk_...          # Your Nylas API key
NYLAS_CLIENT_ID=...             # Your Nylas client ID
NYLAS_CALLBACK_URI=http://localhost:3000/auth/callback
NYLAS_API_URI=https://api.us.nylas.com  # Optional, defaults to US

# Juli Brain callback for OAuth redirects
# IMPORTANT: Juli Brain acts as a middleman and forwards credentials to Integration Platform
# The Integration Platform stores credentials in IBM Gateway's SQLite database (mcp.db)
# This agent (Inbox-MCP) remains completely stateless - no credential storage here
# Example: https://api.juliai.com/auth/callback/inbox-mcp
JULI_BRAIN_CALLBACK_URI=
```

## Credential Usage in Tools

### Extracting Credentials from User Context

All tools receive credentials via the user context:

```typescript
async handleManageEmail(params: ManageEmailParams): Promise<any> {
  // Extract grant ID from user context
  const credentials = params.user_context?.credentials || {};
  const grantId = credentials.EMAIL_ACCOUNT_GRANT;
  
  if (!grantId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'EMAIL_ACCOUNT_GRANT credential is required. Please connect your email account first.'
    );
  }
  
  // Use grant ID with Nylas
  const messages = await this.nylas.messages.list({
    identifier: grantId,
    queryParams: { limit: 10 }
  });
  
  // Process messages...
}
```

### Error Handling for Missing Credentials

When credentials are missing, return a structured error:

```typescript
if (!grantId) {
  return {
    error: {
      code: 'MISSING_CREDENTIALS',
      message: 'Email account not connected',
      required: ['EMAIL_ACCOUNT_GRANT'],
      setup_url: '/auth/connect'
    }
  };
}
```

## Security Considerations

### 1. Stateless Architecture
- **No credential storage**: The agent never writes credentials to disk or memory
- **Per-request injection**: Credentials are provided fresh on each request
- **No session state**: Each request is independent

### 2. Secure Communication
- **HTTPS only**: All OAuth callbacks must use HTTPS in production
- **Header injection**: Credentials transmitted via secure headers, not URLs
- **Validation**: Optional validation endpoints for credential verification

### 3. Error Handling
- **No credential logging**: Never log grant IDs or API keys
- **Masked errors**: Return generic errors to users, log details server-side
- **Graceful degradation**: Handle missing credentials without crashes

## Testing the Implementation

### 1. Manual Testing Flow

```bash
# 1. Start the server
npm run dev

# 2. Get the connect URL
curl http://localhost:3000/auth/connect
# Returns: { "url": "https://api.us.nylas.com/v3/connect/auth?..." }

# 3. Open URL in browser and complete OAuth

# 4. Verify redirect to Juli Brain
# Should redirect to JULI_BRAIN_CALLBACK_URI with grant_id

# 5. Test tool with injected credential
curl -X POST http://localhost:3000/a2a/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tool.execute",
    "params": {
      "tool": "find_emails",
      "arguments": { "query": "unread" },
      "user_context": {
        "credentials": {
          "EMAIL_ACCOUNT_GRANT": "grant_xxx"
        }
      }
    }
  }'
```

### 2. Integration Testing

```typescript
describe('OAuth Flow', () => {
  it('should redirect to Juli Brain on successful auth', async () => {
    const response = await request(app)
      .get('/auth/callback')
      .query({ code: 'test_code' });
    
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain(JULI_BRAIN_CALLBACK_URI);
    expect(response.headers.location).toContain('grant_id=');
    expect(response.headers.location).toContain('status=success');
  });
  
  it('should redirect with error on auth failure', async () => {
    const response = await request(app)
      .get('/auth/callback')
      .query({ error: 'access_denied' });
    
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('status=error');
  });
});
```

## Troubleshooting

### Common Issues

1. **Missing JULI_BRAIN_CALLBACK_URI**
   - **Error**: Server exits on startup
   - **Solution**: Set the environment variable in `.env`

2. **OAuth callback fails**
   - **Error**: "Invalid grant" or authentication error
   - **Solution**: Verify Nylas client ID and callback URI match

3. **Credentials not injected**
   - **Error**: "EMAIL_ACCOUNT_GRANT credential is required"
   - **Solution**: Verify Integration Platform is forwarding credentials

4. **Grant ID expired**
   - **Error**: Nylas API returns 401
   - **Solution**: Re-authenticate through `/auth/connect`

### Debug Logging

Enable detailed logging:

```bash
NODE_ENV=development npm run dev
```

This will show:
- OAuth flow steps
- Credential extraction
- Nylas API calls
- Error details (server-side only)

## Conclusion

The Inbox-MCP authentication implementation follows the A2A specification by:
1. Remaining completely stateless
2. Using Nylas Hosted Auth to abstract OAuth complexity
3. Redirecting to Juli Brain for credential storage
4. Accepting credentials via header injection
5. Providing clear setup and error flows

This architecture ensures security, scalability, and consistency across all Juli AI agents.