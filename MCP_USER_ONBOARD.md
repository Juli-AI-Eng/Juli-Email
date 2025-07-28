# MCP User Onboarding & Credential Flow Guide

## Overview

This guide covers the complete user journey from discovering an MCP toolkit to successfully using it:

1. User finds a toolkit they want to use (e.g., Weather MCP)
2. User needs to create/have an account with the underlying service (e.g., OpenWeatherMap)
3. User connects the service to Juli by providing credentials
4. Juli stores credentials securely
5. User can now use the MCP toolkit

---

## The Complete User Journey

### Step 1: User Discovers MCP Toolkit

```
Juli Platform UI:
┌─────────────────────────────────────────────┐
│ Available Toolkits                          │
├─────────────────────────────────────────────┤
│ 🌤️ Weather Intelligence MCP                 │
│ Get weather data and forecasts              │
│                                             │
│ Requirements:                               │
│ • OpenWeatherMap account (free tier avail) │
│ • API key from OpenWeatherMap              │
│                                             │
│ [Connect] →                                 │
└─────────────────────────────────────────────┘
```

### Step 2: User Clicks Connect

Juli checks if user already has credentials:

```javascript
// Juli Frontend
async function connectToolkit(toolkitId) {
  // Check if already connected
  const response = await fetch(`/api/user/toolkits/${toolkitId}/status`);
  const { connected, auth_config } = await response.json();
  
  if (connected) {
    showMessage('Already connected!');
    return;
  }
  
  // Show connection flow based on auth type
  if (auth_config.type === 'api_key') {
    showApiKeyFlow(toolkitId, auth_config);
  } else if (auth_config.type === 'oauth2') {
    showOAuthFlow(toolkitId, auth_config);
  }
}
```

---

## API Key Authentication Flow

### What Juli Shows User

```
┌─────────────────────────────────────────────┐
│ Connect Weather Intelligence MCP            │
├─────────────────────────────────────────────┤
│ This toolkit requires an OpenWeatherMap     │
│ API key.                                    │
│                                             │
│ Don't have an account?                      │
│ 1. Create account at openweathermap.org    │
│ 2. Go to API Keys section                  │
│ 3. Generate a new API key                  │
│ 4. Copy and paste it below                 │
│                                             │
│ [Guide: How to get API key] →              │
│                                             │
│ OpenWeatherMap API Key:                     │
│ [_________________________________]         │
│                                             │
│ [Cancel]  [Connect]                        │
└─────────────────────────────────────────────┘
```

### MCP Registration with Help Info

```json
{
  "toolkit_type": "mcp_server",
  "name": "Weather Intelligence MCP",
  "description": "Advanced weather data and forecasting",
  "version": "1.0.0",
  
  "connection_config": {
    "transport": "http",
    "base_url": "https://weather-mcp.example.com",
    
    "auth_config": {
      "type": "api_key",
      "service_info": {
        "name": "OpenWeatherMap",
        "signup_url": "https://openweathermap.org/sign_up",
        "pricing": "Free tier includes 1,000 calls/day",
        "time_to_setup": "5 minutes"
      },
      "credentials_required": [
        {
          "key": "OPENWEATHER_API_KEY",
          "display_name": "OpenWeatherMap API Key",
          "description": "Your personal API key from OpenWeatherMap",
          "setup_steps": [
            "Sign up at https://openweathermap.org/sign_up",
            "Verify your email address",
            "Go to 'API Keys' in your account",
            "Click 'Generate' to create a new key",
            "Copy the key (looks like: abc123def456...)"
          ],
          "help_url": "https://openweathermap.org/guide",
          "validation": {
            "format": "^[a-f0-9]{32}$",
            "test_endpoint": "https://api.openweathermap.org/data/2.5/weather?q=London&appid={value}"
          }
        }
      ]
    }
  }
}
```

### User Provides API Key

```javascript
// Juli Frontend
async function submitApiKey(toolkitId, apiKey) {
  showLoading('Validating API key...');
  
  try {
    const response = await fetch(`/api/user/toolkits/${toolkitId}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentials: {
          OPENWEATHER_API_KEY: apiKey
        }
      })
    });
    
    if (response.ok) {
      showSuccess('Connected successfully!');
    } else {
      const error = await response.json();
      showError(error.message);
    }
  } catch (error) {
    showError('Failed to connect');
  }
}
```

### Juli Backend Validates & Stores

```javascript
// Juli Backend
app.post('/api/user/toolkits/:toolkitId/connect', async (req, res) => {
  const { toolkitId } = req.params;
  const { credentials } = req.body;
  const userId = req.user.id;
  
  try {
    // 1. Get toolkit configuration
    const toolkit = await getToolkit(toolkitId);
    
    // 2. Validate credentials format
    validateCredentialFormat(credentials, toolkit.auth_config);
    
    // 3. Test credentials (optional but recommended)
    if (toolkit.auth_config.credentials_required[0].test_endpoint) {
      await testCredentials(credentials, toolkit.auth_config);
    }
    
    // 4. Encrypt and store
    await storeUserCredentials(userId, toolkitId, credentials);
    
    // 5. Return success
    res.json({ 
      status: 'connected',
      message: 'Successfully connected to ' + toolkit.name
    });
    
  } catch (error) {
    res.status(400).json({ 
      error: error.message,
      help_url: toolkit.auth_config.credentials_required[0].help_url
    });
  }
});

async function testCredentials(credentials, authConfig) {
  // Test the API key works
  const testUrl = authConfig.credentials_required[0].test_endpoint
    .replace('{value}', credentials.OPENWEATHER_API_KEY);
  
  const response = await fetch(testUrl);
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check and try again.');
    }
    throw new Error('Could not validate API key');
  }
}

async function storeUserCredentials(userId, toolkitId, credentials) {
  // Encrypt each credential
  const encrypted = {};
  for (const [key, value] of Object.entries(credentials)) {
    encrypted[key] = await encrypt(value);
  }
  
  // Store in database
  await db.user_toolkit_credentials.create({
    user_id: userId,
    toolkit_id: toolkitId,
    encrypted_credentials: JSON.stringify(encrypted),
    connected_at: new Date()
  });
}
```

---

## OAuth2 Authentication Flow

### What User Sees

```
┌─────────────────────────────────────────────┐
│ Connect GitHub MCP                          │
├─────────────────────────────────────────────┤
│ This toolkit needs access to your GitHub    │
│ account.                                    │
│                                             │
│ Permissions needed:                         │
│ • Read your repositories                    │
│ • Read your profile                         │
│ • Create issues (optional)                  │
│                                             │
│ You'll be redirected to GitHub to:         │
│ 1. Log in to your GitHub account           │
│ 2. Review permissions                       │
│ 3. Authorize Juli                          │
│                                             │
│ [Cancel]  [Connect with GitHub] →          │
└─────────────────────────────────────────────┘
```

### OAuth Flow Implementation

```javascript
// 1. User clicks "Connect with GitHub"
async function connectOAuth(toolkitId) {
  // Get OAuth URL from backend
  const response = await fetch(`/api/user/toolkits/${toolkitId}/oauth/start`);
  const { authorization_url } = await response.json();
  
  // Redirect to GitHub
  window.location.href = authorization_url;
}

// 2. Backend generates OAuth URL
app.get('/api/user/toolkits/:toolkitId/oauth/start', async (req, res) => {
  const { toolkitId } = req.params;
  const userId = req.user.id;
  
  const toolkit = await getToolkit(toolkitId);
  const state = generateSecureState(userId, toolkitId);
  
  const authUrl = new URL(toolkit.auth_config.oauth_config.authorization_url);
  authUrl.searchParams.append('client_id', process.env.GITHUB_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', 'https://app.juli.com/oauth/callback');
  authUrl.searchParams.append('scope', toolkit.auth_config.oauth_config.scopes.join(' '));
  authUrl.searchParams.append('state', state);
  
  res.json({ authorization_url: authUrl.toString() });
});

// 3. Handle OAuth callback
app.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.redirect('/integrations?error=auth_denied');
  }
  
  const { userId, toolkitId } = verifyState(state);
  
  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, toolkitId);
    
    // Store tokens
    await storeUserCredentials(userId, toolkitId, {
      ACCESS_TOKEN: tokens.access_token,
      REFRESH_TOKEN: tokens.refresh_token
    });
    
    res.redirect('/integrations?success=true&toolkit=' + toolkitId);
    
  } catch (error) {
    res.redirect('/integrations?error=connection_failed');
  }
});
```

---

## Different Service Types

### 1. Free Services with API Keys

**Example: OpenWeatherMap**
```
User Journey:
1. Sign up at openweathermap.org (free)
2. Verify email
3. Generate API key in dashboard
4. Copy key to Juli
```

### 2. Paid Services with API Keys

**Example: OpenAI**
```
User Journey:
1. Create OpenAI account
2. Add payment method ($5 minimum)
3. Generate API key
4. Set usage limits (recommended)
5. Copy key to Juli
```

### 3. OAuth Services

**Example: GitHub**
```
User Journey:
1. Click "Connect with GitHub" in Juli
2. Log in to GitHub (if needed)
3. Review permissions Juli requests
4. Click "Authorize"
5. Redirected back to Juli (connected!)
```

### 4. Enterprise Services

**Example: Salesforce**
```
User Journey:
1. Need Salesforce account with API access
2. Create Connected App in Salesforce
3. Get Consumer Key and Secret
4. Provide credentials to Juli
5. May need to whitelist Juli's IPs
```

---

## Complete Example: Stripe MCP

### MCP Registration

```json
{
  "toolkit_type": "mcp_server",
  "name": "Stripe Payments MCP",
  "description": "Process payments and manage customers",
  "version": "1.0.0",
  
  "connection_config": {
    "transport": "http",
    "base_url": "https://stripe-mcp.example.com",
    
    "auth_config": {
      "type": "api_key",
      "service_info": {
        "name": "Stripe",
        "signup_url": "https://dashboard.stripe.com/register",
        "pricing": "2.9% + 30¢ per successful charge",
        "time_to_setup": "10-15 minutes",
        "requirements": [
          "Business information",
          "Bank account for payouts",
          "Tax ID (for some countries)"
        ]
      },
      "credentials_required": [
        {
          "key": "STRIPE_SECRET_KEY",
          "display_name": "Stripe Secret Key",
          "description": "Your secret API key from Stripe Dashboard",
          "setup_steps": [
            "Sign up at https://stripe.com",
            "Complete business verification",
            "Go to Developers → API keys",
            "Copy the 'Secret key' (starts with sk_live_ or sk_test_)",
            "Use test keys for development (sk_test_...)"
          ],
          "help_url": "https://stripe.com/docs/keys",
          "security_note": "Never share your secret key. It has full access to your Stripe account.",
          "validation": {
            "format": "^sk_(test|live)_[a-zA-Z0-9]{24,}$",
            "test_endpoint": "https://api.stripe.com/v1/charges?limit=1"
          }
        },
        {
          "key": "STRIPE_MODE",
          "display_name": "Mode",
          "description": "Use test mode for development",
          "type": "select",
          "options": [
            { "value": "test", "label": "Test Mode (recommended)" },
            { "value": "live", "label": "Live Mode (real charges)" }
          ],
          "default": "test"
        }
      ]
    }
  }
}
```

### User Flow UI

```javascript
// React component for Stripe connection
function StripeConnectFlow({ toolkit }) {
  const [step, setStep] = useState('intro');
  const [credentials, setCredentials] = useState({});
  
  if (step === 'intro') {
    return (
      <div className="connect-flow">
        <h2>Connect Stripe Payments</h2>
        
        <div className="service-info">
          <p>Stripe is a payment processing platform that lets you:</p>
          <ul>
            <li>Accept credit card payments</li>
            <li>Manage customers and subscriptions</li>
            <li>Handle refunds and disputes</li>
          </ul>
          
          <div className="requirements">
            <h3>What you'll need:</h3>
            <ul>
              <li>Stripe account (free to create)</li>
              <li>Business information</li>
              <li>Bank account for payouts</li>
            </ul>
          </div>
          
          <div className="time-estimate">
            ⏱️ Setup time: 10-15 minutes
          </div>
        </div>
        
        <div className="actions">
          <button onClick={() => window.open('https://stripe.com', '_blank')}>
            Create Stripe Account
          </button>
          <button onClick={() => setStep('credentials')}>
            I have an account →
          </button>
        </div>
      </div>
    );
  }
  
  if (step === 'credentials') {
    return (
      <div className="connect-flow">
        <h2>Enter Stripe Credentials</h2>
        
        <div className="help-box">
          <h3>How to find your API key:</h3>
          <ol>
            <li>Log in to your Stripe Dashboard</li>
            <li>Go to Developers → API keys</li>
            <li>Copy your secret key (starts with sk_)</li>
          </ol>
          <a href="https://dashboard.stripe.com/apikeys" target="_blank">
            Open Stripe API Keys →
          </a>
        </div>
        
        <form onSubmit={(e) => handleSubmit(e, credentials)}>
          <div className="form-group">
            <label>Stripe Secret Key</label>
            <input
              type="password"
              placeholder="sk_test_..."
              value={credentials.STRIPE_SECRET_KEY || ''}
              onChange={(e) => setCredentials({
                ...credentials,
                STRIPE_SECRET_KEY: e.target.value
              })}
            />
            <small>Never share this key with anyone</small>
          </div>
          
          <div className="form-group">
            <label>Mode</label>
            <select
              value={credentials.STRIPE_MODE || 'test'}
              onChange={(e) => setCredentials({
                ...credentials,
                STRIPE_MODE: e.target.value
              })}
            >
              <option value="test">Test Mode (recommended)</option>
              <option value="live">Live Mode (real charges)</option>
            </select>
            <small>Start with test mode to try things out</small>
          </div>
          
          <button type="submit">Connect Stripe</button>
        </form>
      </div>
    );
  }
}
```

---

## Database Schema

```sql
-- Store user credentials for each toolkit
CREATE TABLE user_toolkit_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  toolkit_id VARCHAR(255) NOT NULL,
  
  -- Encrypted credentials (JSON)
  encrypted_credentials TEXT NOT NULL,
  
  -- OAuth specific
  token_expires_at TIMESTAMP,
  refresh_token_expires_at TIMESTAMP,
  
  -- Metadata
  connected_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  last_validated_at TIMESTAMP,
  
  -- Status
  status VARCHAR(50) DEFAULT 'active', -- active, invalid, expired
  
  UNIQUE(user_id, toolkit_id)
);

-- Track connection attempts for security
CREATE TABLE credential_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  toolkit_id VARCHAR(255) NOT NULL,
  action VARCHAR(50), -- connected, disconnected, failed, refreshed
  ip_address VARCHAR(45),
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Security Considerations

### 1. Credential Validation

```javascript
// Always validate before storing
async function validateAndStoreCredentials(userId, toolkitId, credentials) {
  const toolkit = await getToolkit(toolkitId);
  
  // 1. Format validation
  for (const field of toolkit.auth_config.credentials_required) {
    if (field.validation?.format) {
      const regex = new RegExp(field.validation.format);
      if (!regex.test(credentials[field.key])) {
        throw new Error(`Invalid format for ${field.display_name}`);
      }
    }
  }
  
  // 2. Test the credentials
  if (toolkit.auth_config.test_endpoint) {
    await testCredentials(credentials, toolkit);
  }
  
  // 3. Encrypt and store
  const encrypted = await encryptCredentials(credentials);
  await storeInDatabase(userId, toolkitId, encrypted);
  
  // 4. Audit log
  await logCredentialAction(userId, toolkitId, 'connected');
}
```

### 2. Show Security Indicators

```javascript
// Show users their credentials are secure
function CredentialStatus({ toolkit }) {
  return (
    <div className="credential-status">
      <div className="security-badge">
        🔒 Credentials stored securely
      </div>
      
      <div className="details">
        <p>Connected: {toolkit.connected_at}</p>
        <p>Last used: {toolkit.last_used_at}</p>
        
        <button onClick={() => disconnect(toolkit.id)}>
          Disconnect
        </button>
      </div>
      
      <div className="security-info">
        <h4>Your credentials are:</h4>
        <ul>
          <li>✓ Encrypted at rest</li>
          <li>✓ Never shown after entry</li>
          <li>✓ Only used for your requests</li>
          <li>✓ Can be revoked anytime</li>
        </ul>
      </div>
    </div>
  );
}
```

---

## Summary

The complete flow:

1. **Discovery**: User finds MCP toolkit they want
2. **Service Setup**: User creates account with external service (if needed)
3. **Credential Generation**: User gets API key/token from service
4. **Connection**: User provides credentials to Juli
5. **Validation**: Juli validates and stores credentials securely
6. **Usage**: User can now use the MCP toolkit

Key points:
- Make it clear what external service is needed
- Provide step-by-step setup instructions  
- Validate credentials before storing
- Show security measures to build trust
- Allow easy disconnection/reconnection