# A2A Authentication Implementation Changes Required

## Overview

This document outlines the required changes across all Juli AI repositories to properly implement the A2A authentication architecture as specified in `A2A_AUTH_SPECIFICATION.md`.

## Critical Design Update: Manual Instructions as Modifier

**IMPORTANT**: The A2A specification has been updated. "Manual with instructions" is NOT a separate authentication type. Instead, it's an optional modifier that can be added to ANY authentication type (api_key, basic_auth, etc.).

### Correct Pattern
```json
{
  "type": "api_key",  // Base type (api_key, basic_auth, etc.)
  "format_hint": "sk-xxxxxxxx",
  "validation_endpoint": "/validate/api-key",
  
  // Optional manual modifier when user needs guidance
  "manual": {
    "instructions": "Step-by-step guide...",
    "deep_link": "https://service.com/settings",
    "requirements": "Prerequisites..."
  }
}
```

### What This Means
- Reclaim.ai API key: Should be `type: "api_key"` with `manual` modifier
- Any credential requiring external steps: Add `manual` modifier to base type
- Frontend: Check for `manual` object and show instructions conditionally
- Validation endpoints: Named after base type (`/validate/api-key`, not `/validate/manual`)

## Architecture Summary

### Current State
- **Credential Storage**: Two-database system
  - **SQLite (mcp.db)** via IBM Gateway: Stores actual sensitive credentials (API keys, OAuth tokens, grant IDs)
  - **PostgreSQL (auth_handler)**: Stores user profiles and integration access flags
- **Juli Brain**: Acts as middleman/router, does NOT store credentials
- **Integration Platform**: Manages actual credential storage via IBMGatewayClient
- **Agents**: Completely stateless, receive credentials via header injection

### Communication Flow
```
Agent → Juli Brain (redirect) → Integration Platform → IBM Gateway Database
```

## Repository-Specific Changes

### 1. Juli-Integration-Platform

**Current State**: Already has most infrastructure in place but needs clarification on callback handling.

**Required Changes**:

#### A. Add Juli Brain Callback Handler
- **Location**: `dev_platform/app/api/` (new file: `callbacks.py`)
- **Endpoint**: `POST /api/v1/callbacks/oauth/{agent_id}`
- **Purpose**: Receive OAuth callbacks from agents
- **Implementation**:
  ```python
  @router.post("/callbacks/oauth/{agent_id}")
  async def handle_oauth_callback(
      agent_id: str,
      grant_id: str = Query(...),
      credential_key: str = Query(...),
      email: Optional[str] = Query(None),
      status: str = Query(...),
      error: Optional[str] = Query(None),
      current_user: Developer = Depends(get_current_developer)
  ):
      # Store credential via IntegratorService
      # Return success page or redirect to frontend
  ```

#### B. Update IntegratorService
- **File**: `dev_platform/app/services/integrator_service.py`
- **Changes**: 
  - Add method to handle OAuth callback credentials
  - Map `agent_id` to correct `gateway_slug`
  - Store credentials with proper key mapping

#### C. Credential Key Mapping
- **File**: `integrator/mcp_gateway/ibm_gateway_integration.py`
- **Changes**:
  - Standardize credential key names across agents
  - Add mapping table for `agent_id` → `gateway_slug` → `credential_keys`

### 2. Juli Brain (juli-brain-5)

**Current State**: Has GatewayAuthManager and DevPlatformClient but missing OAuth callback handler.

**Required Changes**:

#### A. Add OAuth Callback Handler
- **Location**: `main_flow/src/oauth_callback_handler.py` (new file)
- **Purpose**: Receive redirects from agents and forward to Integration Platform
- **Implementation**:
  ```python
  async def handle_agent_oauth_callback(
      agent_id: str,
      grant_id: str,
      credential_key: str,
      email: Optional[str] = None,
      status: str = "success",
      error: Optional[str] = None,
      user_id: str = None  # From session
  ):
      # Extract user_id from session/context
      # Forward to Integration Platform via DevPlatformClient
      # Return success page to user
  ```

#### B. Update User Onboarding
- **File**: `main_flow/composio_local/src/user_onboarding.py`
- **Changes**:
  - Remove hardcoded credential injection
  - Add method to check for pending OAuth flows
  - Integrate with new callback handler

#### C. Update GatewayAuthManager
- **File**: `main_flow/composio_local/src/gateway_auth_manager.py`
- **Changes**:
  - Add method to handle OAuth callback credentials
  - Ensure proper mapping of `credential_key` to gateway requirements

### 3. Juli-Calendar

**Current State**: OAuth callback returns JSON instead of redirecting to Juli Brain. Missing JULI_BRAIN_CALLBACK_URI entirely.

**Required Changes**:

#### A. Complete OAuth Callback Rewrite
- **File**: `src/server.py`
- **Function**: `nylas_calendar_callback` (lines ~415-500)
- **Current Problem**: Returns JSON directly instead of redirecting to Juli Brain
- **Changes Required**:
  ```python
  # CURRENT (WRONG):
  return jsonify({
      "success": True,
      "grant_id": grant_id,
      "email": email,
      "calendar_email": email,
      "message": "Calendar connected successfully!",
      "next_step": "Connect Reclaim.ai using the SAME calendar account"
  })
  
  # SHOULD BE:
  juli_brain_callback = os.getenv("JULI_BRAIN_CALLBACK_URI")
  if not juli_brain_callback:
      logger.error("JULI_BRAIN_CALLBACK_URI not configured")
      return jsonify({"error": "Server misconfigured"}), 500
  
  from urllib.parse import urlencode
  params = {
      'grant_id': grant_id,
      'credential_key': 'CALENDAR_ACCOUNT_GRANT',
      'agent_id': 'juli-calendar',  # NOT 'inbox-mcp'!
      'email': email,
      'status': 'success'
  }
  redirect_url = f"{juli_brain_callback}?{urlencode(params)}"
  return redirect(redirect_url)
  ```

#### B. Add Environment Variable
- **File**: `.env.example`
- **Add**:
  ```bash
  # Juli Brain callback for OAuth redirects
  # IMPORTANT: Juli Brain forwards to Integration Platform for storage
  JULI_BRAIN_CALLBACK_URI=https://api.juliai.com/auth/callback/juli-calendar
  ```

#### C. Standardize Credential Keys
- **File**: `src/a2a/handlers.py`
- **Function**: `get_credentials_manifest()`
- **Changes**:
  - Keep `NYLAS_GRANT_ID` in manifest (this is what the agent expects)
  - But in callback, use `credential_key=NYLAS_GRANT_ID` to match
  - OR change everywhere to use `CALENDAR_ACCOUNT_GRANT` for consistency

#### D. Add Error Handling
- **File**: `src/server.py`
- **Changes**:
  - On OAuth error, redirect to Juli Brain with error status
  - Include error message in redirect parameters
  ```python
  except Exception as e:
      if juli_brain_callback:
          params = {
              'status': 'error',
              'error': str(e),
              'agent_id': 'juli-calendar',
              'credential_key': 'NYLAS_GRANT_ID'
          }
          redirect_url = f"{juli_brain_callback}?{urlencode(params)}"
          return redirect(redirect_url)
      # Fallback to JSON only if JULI_BRAIN_CALLBACK_URI not set
      return jsonify({"error": str(e)}), 500
  ```

#### E. Fix Manual Authentication (Reclaim API Key) to Follow A2A Spec
- **Current State**: Wrong implementation - doesn't follow A2A spec where manual is a modifier
- **Problems**:
  1. Should be `api_key` type with `manual` modifier, not a separate type
  2. Validation endpoint stores nothing - just returns JSON
  3. No way for credential to reach Juli Brain/Integration Platform

**Required Changes**:

**1. Fix Credential Manifest**:
- **File**: `src/a2a/handlers.py`
- **Change to api_key with manual modifier**:
  ```json
  {
    "key": "RECLAIM_API_KEY",
    "display_name": "Reclaim.ai API Key",
    "flows": [
      {
        "type": "api_key",  // CORRECT: api_key type
        "format_hint": "reclm_xxxxxxxxxx",
        "validation_endpoint": "/validate/api-key",
        
        // Add manual modifier since user must obtain key externally
        "manual": {
          "instructions": "1. Log into Reclaim.ai\n2. Go to Settings > Integrations > API Keys\n3. Create a new key\n4. Copy the key below",
          "deep_link": "https://app.reclaim.ai/settings/integrations/api-keys",
          "requirements": "You must have a Reclaim.ai account with the same calendar connected to Nylas"
        }
      }
    ]
  }
  ```

**2. Update Validation Endpoint**:
- **File**: `src/server.py`
- **Change**: `/setup/validate-reclaim` → `/validate/api-key`
- **Behavior**: Should ONLY validate, not store

**3. Follow Correct Flow**:
  ```
  Per A2A Spec (api_key with manual modifier):
  1. Frontend gets api_key flow with manual instructions from manifest
  2. Frontend shows instructions and deep_link to user
  3. User obtains API key from Reclaim.ai
  4. Frontend submits to Juli Brain (NOT to agent)
  5. Juli Brain calls agent's /validate/api-key (optional)
  6. If valid, Juli Brain stores in Integration Platform
  ```

**4. Fix Validation Endpoint Response**:
- **File**: `src/server.py`
- **Function**: `validate_api_key()` (renamed from `setup_validate_reclaim`)
  ```python
  @app.route("/validate/api-key", methods=["POST"])
  def validate_api_key():
      """
      Validate API key credential per A2A spec.
      Called by Juli Brain, not directly by frontend.
      """
      data = request.get_json()
      credential_key = data.get("credential_key")
      credential_value = data.get("credential_value")
      
      if credential_key == "RECLAIM_API_KEY":
          # Validate the Reclaim API key
          if validate_reclaim_key(credential_value):
              return jsonify({"valid": True})
          else:
              return jsonify({"valid": False, "error": "Invalid API key format or inactive"})
      
      return jsonify({"valid": False, "error": "Unknown credential key"}), 400
  ```

#### F. Implement Multi-Credential Flow Coordination
- **Current State**: Requires both NYLAS_GRANT_ID and RECLAIM_API_KEY but no unified flow
- **Problem**: No way to track partial completion or guide user through both credentials
- **Required Changes**:

  **1. Add credential status endpoint**:
  - **File**: `src/server.py`
  - **New Endpoint**: `/setup/status`
  ```python
  @app.route("/setup/status", methods=["GET"])
  def setup_status():
      """Check which credentials are already stored in Juli Brain"""
      # This should query Juli Brain/Integration Platform
      # to see which credentials are already stored
      return jsonify({
          "credentials": {
              "NYLAS_GRANT_ID": {
                  "stored": False,  # or True if already in DB
                  "type": "hosted_auth"
              },
              "RECLAIM_API_KEY": {
                  "stored": False,
                  "type": "api_key",
                  "has_manual": True
              }
          },
          "complete": False,  # True only if both stored
          "next_credential": "NYLAS_GRANT_ID"  # Which to acquire first
      })
  ```

  **2. Add calendar matching validation**:
  - **File**: `src/setup/setup_manager.py`
  - **Issue**: Currently validates locally but doesn't inform Juli Brain
  - **Solution**: After both credentials acquired, validate they use same calendar
  ```python
  # After both credentials are stored in Juli Brain:
  if calendar_mismatch:
      # Notify Juli Brain to mark credentials as invalid
      # or require re-authentication
  ```

#### G. Update Credential Manifest for Multi-Credential
- **File**: `src/a2a/handlers.py`
- **Function**: `get_credentials_manifest()`
- **Enhancement**: Add relationship between credentials
  ```json
  {
    "credentials": [
      {
        "key": "NYLAS_GRANT_ID",
        "display_name": "Calendar Account",
        "required": true,
        "flows": [...]
      },
      {
        "key": "RECLAIM_API_KEY",
        "display_name": "Reclaim.ai API Key",
        "required": true,
        "flows": [...],
        "validation_requirements": {
          "must_match_calendar": "NYLAS_GRANT_ID"
        }
      }
    ],
    "validation": {
      "type": "calendar_match",
      "message": "Both services must use the same calendar account"
    }
  }
  ```

### 4. Inbox-MCP (Current Repository)

**Current State**: Recently updated to redirect to Juli Brain, implementation mostly complete.

**Required Changes**:

#### A. Verify Credential Key Consistency
- **File**: `src/server.ts`
- **Verification**: Ensure `EMAIL_ACCOUNT_GRANT` is used consistently
- **Status**: ✅ Already correct

#### B. Add Credential Manifest Validation
- **File**: `src/server.ts`
- **Changes**:
  - Add startup check that manifest matches actual implementation
  - Log any discrepancies

### 5. Juli-5-Frontend

**Current State**: Uses Auth0 for user authentication, needs comprehensive auth flow handling for all 5 auth types.

**Required Changes**:

#### A. Add Auth Flow Components for All Types
- **Location**: `src/components/auth/` (new directory)
- **Components Required**:
  
  **1. OAuth2 Flow Components**:
  - `OAuth2Flow.jsx`: Handle full OAuth2 with refresh tokens
  - `OAuth2Callback.jsx`: Process OAuth2 callbacks
  - Shows authorization URL, handles redirects
  
  **2. Hosted Auth Flow Components**:
  - `HostedAuthFlow.jsx`: Handle simplified OAuth (Nylas-style)
  - `HostedAuthStatus.jsx`: Show connection status
  - Redirects to agent's connect URL
  
  **3. API Key Flow Components**:
  - `APIKeyInput.jsx`: Input field with format hint
  - `APIKeyValidation.jsx`: Show validation status
  - Supports format hints like "sk-xxxxxxxx"
  - **With Manual Modifier**: Shows instructions and deep link when `manual` object present
  
  **4. Basic Auth Flow Components**:
  - `BasicAuthForm.jsx`: Username/password form
  - Dynamic fields based on manifest
  - **With Manual Modifier**: Shows instructions when `manual` object present
  
  **5. Manual Instructions Components** (used by any type with `manual` modifier):
  - `ManualInstructions.jsx`: Display step-by-step instructions
  - `DeepLinkButton.jsx`: Open external service in new tab
  - `ManualCredentialInput.jsx`: Input field with validation
  - These components are conditionally rendered when any auth type includes `manual` object

#### B. Add Multi-Credential Support
- **Component**: `MultiCredentialFlow.jsx`
- **Purpose**: Handle agents requiring multiple credentials
- **Features**:
  - Show progress for each credential
  - Sequential or parallel credential acquisition
  - Example: Calendar needs both NYLAS_GRANT_ID and RECLAIM_API_KEY

#### C. Update API Client
- **File**: `src/services/apiClient.js`
- **New Methods**:
  ```javascript
  // Discover agent credentials
  getAgentManifest(agentId)
  
  // Initiate auth flows
  startOAuth2Flow(agentId, credentialKey)
  startHostedAuthFlow(agentId, credentialKey)
  validateAPIKey(agentId, credentialKey, value)
  validateBasicAuth(agentId, credentialKey, username, password)
  validateManualCredential(agentId, credentialKey, value)
  
  // Check status
  getAgentAuthStatus(agentId)
  getUserIntegrations()
  ```

#### D. Add Integration Status Dashboard
- **Location**: `src/pages/IntegrationsDashboard.jsx`
- **Features**:
  - List all available agents
  - Show connection status for each
  - Display required credentials per agent
  - One-click connect/disconnect
  - Show which auth type each credential uses
  - Handle multi-credential agents

#### E. Add OAuth Callback Handler Page
- **Location**: `src/pages/auth/OAuthCallback.jsx`
- **Purpose**: Handle returns from OAuth providers
- **Flow**:
  1. Extract query parameters (grant_id, status, error)
  2. Display success or error message
  3. Redirect to integrations dashboard
  4. Handle both agent callbacks and Auth0 callbacks

#### F. Add Credential Management UI
- **Location**: `src/components/credentials/`
- **Components**:
  - `CredentialsList.jsx`: Show all stored credentials
  - `CredentialCard.jsx`: Display individual credential
  - `RemoveCredentialButton.jsx`: Allow credential removal
  - `RefreshCredentialButton.jsx`: Manual refresh for OAuth2

#### G. Handle Manual Modifier Pattern
- **Key Design Change**: Manual instructions are NOT a separate auth type
- **Implementation Pattern**:
  ```javascript
  // Check if any auth type has manual modifier
  if (flow.manual) {
    // Show ManualInstructions component
    // Show DeepLinkButton if deep_link provided
    // Show requirements if specified
  }
  
  // Then show the base auth type component (api_key, basic_auth, etc.)
  switch(flow.type) {
    case 'api_key':
      // Show APIKeyInput (with instructions above if manual exists)
      break;
    case 'basic_auth':
      // Show BasicAuthForm (with instructions above if manual exists)
      break;
    // etc.
  }
  ```

## Communication Specifications

### 1. Agent → Juli Brain Redirect
```
GET /auth/callback/{agent_id}?
  grant_id={value}&
  credential_key={KEY_NAME}&
  agent_id={agent_id}&
  email={optional}&
  status={success|error}&
  error={optional_message}
```

### 2. Juli Brain → Integration Platform
```
POST /api/v1/callbacks/oauth/{agent_id}
Headers:
  X-User-ID: {user_id}
  Authorization: Bearer {juli_brain_token}
Body:
  {
    "grant_id": "...",
    "credential_key": "...",
    "email": "...",
    "status": "success"
  }
```

### 3. Integration Platform → IBM Gateway
```
PUT /resources
Body:
  {
    "uri": "user-auth-{user_id}",
    "data": {
      "{gateway_slug}": {
        "{credential_key}": "{credential_value}"
      }
    }
  }
```

### 4. Integration Platform → Agent (Credential Injection)
```
POST /a2a/rpc
Headers:
  Authorization: Bearer {oidc_token}
Body:
  {
    "jsonrpc": "2.0",
    "method": "tool.execute",
    "params": {
      "tool": "...",
      "user_context": {
        "credentials": {
          "{CREDENTIAL_KEY}": "{value}"
        }
      }
    }
  }
```

## Credential Key Standardization

### Naming Convention
All credential keys should follow this pattern:
- `{SERVICE}_{TYPE}_{SUFFIX}`
- Examples:
  - `EMAIL_ACCOUNT_GRANT` (Nylas email grant)
  - `CALENDAR_ACCOUNT_GRANT` (Nylas calendar grant)
  - `RECLAIM_API_KEY` (Reclaim.ai API key)
  - `SLACK_OAUTH_TOKEN` (Slack OAuth token)

### Agent ID Mapping
```json
{
  "inbox-mcp": {
    "gateway_slug": "email-toolkit",
    "credentials": ["EMAIL_ACCOUNT_GRANT"]
  },
  "juli-calendar": {
    "gateway_slug": "calendar-toolkit",
    "credentials": ["CALENDAR_ACCOUNT_GRANT", "RECLAIM_API_KEY"]
  }
}
```

## Testing Requirements

### 1. End-to-End OAuth Flow
- User initiates connection from frontend
- Agent redirects to provider (e.g., Nylas)
- Provider redirects back to agent
- Agent redirects to Juli Brain
- Juli Brain forwards to Integration Platform
- Integration Platform stores in IBM Gateway
- Verify credential injection on next tool call

### 2. Credential Injection Verification
- Call agent tool without credentials → Should fail with MISSING_CREDENTIALS
- Store credentials via OAuth flow
- Call same tool → Should succeed with injected credentials

### 3. Multi-Agent Coordination
- Connect multiple agents (inbox-mcp, juli-calendar)
- Verify each agent receives only its own credentials
- Test cross-agent tool calls with proper credential isolation

## Security Considerations

1. **Never log credentials**: All components must mask/redact credentials in logs
2. **HTTPS only**: All OAuth callbacks must use HTTPS in production
3. **Validate callbacks**: Verify `state` parameter to prevent CSRF
4. **Credential isolation**: Each agent only receives its own credentials
5. **Token expiry**: Handle OAuth token refresh automatically

## Migration Path

### Phase 1: Infrastructure (Week 1)
1. Update Integration Platform with callback handler
2. Update Juli Brain with OAuth callback router
3. Standardize credential key names

### Phase 2: Agent Updates (Week 2)
1. Fix Juli-Calendar agent_id and credential keys
2. Verify Inbox-MCP implementation
3. Update any other A2A agents

### Phase 3: Frontend Integration (Week 3)
1. Add OAuth status pages
2. Create integration dashboard
3. Test end-to-end flows

### Phase 4: Testing & Documentation (Week 4)
1. Comprehensive testing
2. Update all documentation
3. Create developer guides

## Conclusion

The architecture is mostly in place but needs these specific updates to properly route OAuth callbacks through Juli Brain to the Integration Platform for storage in the IBM Gateway database. The key principle to maintain is that agents remain stateless and Juli Brain acts only as a router, never storing credentials directly.