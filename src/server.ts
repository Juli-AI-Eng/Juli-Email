#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import Nylas from 'nylas';
import { OAuth2Client } from 'google-auth-library';

// Import our components
import { EmailAI } from './ai/emailAI.js';
// ApprovalManager removed - using stateless approval flow
import { SetupManager } from './setup/setupManager.js';
import { ManageEmailTool } from './tools/manageEmail.js';
import { FindEmailsTool } from './tools/findEmails.js';
import { OrganizeInboxTool } from './tools/organizeInbox.js';
import { EmailInsightsTool } from './tools/emailInsights.js';
import { SmartFoldersTool } from './tools/smartFolders.js';

// Import types
import {
  ManageEmailParams,
  FindEmailsParams,
  OrganizeInboxParams,
  EmailInsightsParams,
  SmartFoldersParams,
  SetupResponse
} from './types/index.js';

// Zod schemas for our AI-powered tools
const ManageEmailSchema = z.object({
  action: z.enum(['send', 'reply', 'forward', 'draft']).describe('Choose send for new emails, reply to respond to someone, forward to share an email, or draft to save without sending'),
  query: z.string().describe('Describe what you want in the email. Be natural! Examples: "tell John I\'ll be late to the meeting", "thank Sarah for the proposal and ask about pricing", "forward this to the team with my thoughts"'),
  context_message_id: z.string().optional().describe('Email ID if replying/forwarding (I\'ll find it if you don\'t provide it)'),
  require_approval: z.boolean().optional().default(true).describe('Show preview before sending (default: true for safety)'),

  // Context injection fields from Juli
  user_name: z.string().optional().describe('User\'s name from context injection'),
  user_email: z.string().optional().describe('User\'s email from context injection'),

  // Stateless approval fields
  approved: z.boolean().optional().describe('Whether this is an approved action execution'),
  action_data: z.object({
    email_content: z.any(),
    original_params: z.any()
  }).optional().describe('Complete action data for approved execution')
}).describe('Compose emails naturally - just tell me what you want to say and I\'ll write a professional email. Works for new emails, replies, and forwards.');

const FindEmailsSchema = z.object({
  query: z.string().describe('Describe what emails you\'re looking for in plain English. Examples: "unread emails from my boss", "invoices from last month", "anything I need to respond to today", "emails about the Q3 project"'),
  analysis_type: z.enum(['full', 'summary', 'detailed', 'action_items', 'priority']).optional().default('summary')
    .describe('How much detail you want: summary (quick overview), full (complete emails), detailed (emails + importance analysis), action_items (emails + tasks to do), priority (emails sorted by importance)'),
  limit: z.number().optional().default(20).describe('How many emails to return (default: 20)')
}).describe('Search your emails naturally and get exactly what you need - from quick summaries to detailed analysis with action items.');

const OrganizeInboxSchema = z.object({
  instruction: z.string().describe('Tell me how you want to organize your emails. Examples: "archive all newsletters older than a week", "star important emails from clients", "clean up promotional emails", "organize by project", "file all receipts"'),
  scope: z.object({
    folder: z.string().optional().default('inbox').describe('Which folder to organize (default: inbox)'),
    date_range: z.string().optional().describe('Time range like "last week" or "older than 30 days"'),
    limit: z.number().optional().default(100).describe('Max emails to process at once')
  }).optional().describe('Scope of organization'),
  dry_run: z.boolean().optional().default(true).describe('Preview what will happen before making changes (default: true for safety)'),

  // New stateless approval fields
  approved: z.boolean().optional().describe('Whether this is an approved action execution'),
  action_data: z.object({
    organization_plan: z.any(),
    original_params: z.any()
  }).optional().describe('Complete action data for approved execution')
}).describe('Clean up and organize your inbox intelligently. Tell me what you want to do and I\'ll handle the details - always with a preview first.');

const EmailInsightsSchema = z.object({
  query: z.string()
    .describe('Natural language request for email insights. Examples: "summarize my emails today", "what emails need my response?", "show me email analytics for this week", "who am I communicating with most?", "what important emails did I get this week?"'),
  time_period: z.string().optional().default('today')
    .describe('Time period in natural language like "today", "this week", "last month"')
}).describe('Get AI-powered insights and summaries about your email patterns, important items, and what needs attention');

const SmartFoldersSchema = z.object({
  query: z.string().describe('Describe what you want to do with folders. Examples: "create a folder for urgent client emails", "set up folders for each project", "make a folder for receipts and invoices", "show me my folders"'),
  folder_name: z.string().optional().describe('Name for the folder (I\'ll suggest one if you don\'t specify)'),
  dry_run: z.boolean().optional().default(true).describe('Preview the folder rules before creating (default: true)'),

  // New stateless approval fields
  approved: z.boolean().optional().describe('Whether this is an approved action execution'),
  action_data: z.object({
    folder_plan: z.any(),
    original_params: z.any()
  }).optional().describe('Complete action data for approved execution')
}).describe('Create smart folders that automatically organize emails based on your rules. Just describe what should go in the folder and I\'ll set it up.');


// Middleware to extract credentials from headers
interface UserCredentials {
  nylasGrantId?: string;
}

function extractCredentials(headers: any): UserCredentials {
  const credentials: UserCredentials = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith('x-user-credential-')) {
      const credKey = key.toLowerCase()
        .replace('x-user-credential-', '')
        .replace(/-/g, '_')
        .toUpperCase();

      switch (credKey) {
        case 'NYLAS_GRANT_ID':
          credentials.nylasGrantId = value as string;
          break;
      }
    }
  }

  return credentials;
}

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_VERSION = '2.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Request context
interface RequestContext {
  userId?: string;
  requestId?: string;
  credentials: UserCredentials;
}

// Middleware to create request context
app.use((req, res, next) => {
  const context: RequestContext = {
    userId: req.headers['x-platform-user-id'] as string,
    requestId: req.headers['x-platform-request-id'] as string,
    credentials: extractCredentials(req.headers)
  };

  res.locals.context = context;
  next();
});

// Logger for server
const logger = {
  log: console.log,
  error: console.error,
  warn: console.warn
};

// Helper to build a Hosted Auth URL (no redirect)
function buildHostedAuthUrl(params: {
  requestBase: string;
  scope?: string;
  prompt?: string;
  loginHint?: string;
  redirectUriOverride?: string;
}): string {
  if (!NYLAS_API_KEY || !NYLAS_CLIENT_ID) {
    throw new Error('NYLAS_API_KEY and NYLAS_CLIENT_ID must be set');
  }
  const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
  const redirect = params.redirectUriOverride || `${params.requestBase}/api/nylas-email/callback`;
  const rawScope = params.scope || '';
  const scope = rawScope
    ? rawScope.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const authUrl = (nylas as any).auth.urlForOAuth2({
    clientId: NYLAS_CLIENT_ID,
    redirectUri: redirect,
    ...(params.loginHint ? { loginHint: params.loginHint } : {}),
    ...(params.prompt ? { prompt: params.prompt } : {}),
    ...(scope ? { scope } : {})
  });
  return authUrl;
}

// --- Nylas Hosted Auth routes ---
// Environment-driven configuration
const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_CLIENT_ID = process.env.NYLAS_CLIENT_ID;
const NYLAS_CALLBACK_URI = process.env.NYLAS_CALLBACK_URI;
const NYLAS_API_URI = process.env.NYLAS_API_URI; // optional (defaults to US)

// --- A2A (Agent-to-Agent) configuration ---
const A2A_AUDIENCE = process.env.A2A_AUDIENCE || '';
const A2A_DEV_SHARED_SECRET = process.env.A2A_DEV_SHARED_SECRET || '';
const A2A_TRUSTED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const oidcClient = new OAuth2Client();

async function authenticateAgent(req: express.Request): Promise<{ sub?: string; email?: string } | null> {
  const authz = req.headers['authorization'] as string | undefined;

  // Primary: OIDC Bearer token
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const idToken = authz.slice(7).trim();
    try {
      const ticket = await oidcClient.verifyIdToken({ idToken, audience: A2A_AUDIENCE || undefined });
      const payload = ticket.getPayload();
      if (payload && (!payload.iss || A2A_TRUSTED_ISSUERS.includes(String(payload.iss)))) {
        return { sub: payload.sub, email: (payload.email as string) };
      }
    } catch (err) {
      // fall through to dev secret
    }
  }

  // Dev fallback: shared secret header
  const devSecret = req.headers['x-a2a-dev-secret'] as string | undefined;
  if (A2A_DEV_SHARED_SECRET && devSecret && devSecret === A2A_DEV_SHARED_SECRET) {
    return { sub: 'dev-agent', email: 'dev@local' };
  }

  return null;
}

function buildA2ACapabilities() {
  return [
    {
      name: 'manage_email',
      description: ManageEmailSchema.description,
      input_schema: (() => {
        const schema = zodToJsonSchema(ManageEmailSchema) as any;
        if (schema.properties) {
          schema.properties.user_name = {
            ...schema.properties.user_name,
            'x-context-injection': 'user_name'
          };
          schema.properties.user_email = {
            ...schema.properties.user_email,
            'x-context-injection': 'user_email'
          };
        }
        return schema;
      })()
    },
    { name: 'find_emails', description: FindEmailsSchema.description, input_schema: zodToJsonSchema(FindEmailsSchema) },
    { name: 'organize_inbox', description: OrganizeInboxSchema.description, input_schema: zodToJsonSchema(OrganizeInboxSchema) },
    { name: 'email_insights', description: EmailInsightsSchema.description, input_schema: zodToJsonSchema(EmailInsightsSchema) },
    { name: 'smart_folders', description: SmartFoldersSchema.description, input_schema: zodToJsonSchema(SmartFoldersSchema) }
  ];
}

function buildAgentCard(req: express.Request) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const authSchemes: any[] = [
    {
      type: 'oidc',
      audience: A2A_AUDIENCE || baseUrl,
      issuers: A2A_TRUSTED_ISSUERS
    }
  ];
  if (A2A_DEV_SHARED_SECRET) {
    authSchemes.push({ type: 'shared_secret', header: 'X-A2A-Dev-Secret' });
  }
  const card: any = {
    agent_id: 'inbox-mcp',
    version: SERVICE_VERSION,
    description: 'Email agent that can compose, find, organize, and analyze email. Supports approval-first execution and agent-to-agent auth.',
    auth: authSchemes.length === 1 ? authSchemes[0] : { schemes: authSchemes },
    approvals: { modes: ['stateless_preview_then_approve'] },
    context_requirements: { credentials: ['EMAIL_ACCOUNT_GRANT'] },
    capabilities: buildA2ACapabilities(),
    rpc: { endpoint: '/a2a/rpc' },
    extensions: {
      'x-juli': {
        credentials_manifest: '/.well-known/a2a-credentials.json'
      }
    }
  };
  return card;
}

// GET /nylas/auth - Redirect user to Nylas Hosted Auth
// Optional query params:
//   login_hint: prefill user email
//   prompt: customize provider selection UI (e.g., detect,select_provider)
//   scope: comma-separated scopes list
//   redirect_uri: override callback (falls back to env)
app.get('/nylas/auth', (req, res) => {
  try {
    if (!NYLAS_API_KEY || !NYLAS_CLIENT_ID || (!NYLAS_CALLBACK_URI && !req.query.redirect_uri)) {
      return res.status(500).json({
        error: 'Server is not configured for Hosted Auth. Set NYLAS_API_KEY, NYLAS_CLIENT_ID, and NYLAS_CALLBACK_URI.'
      });
    }

    const requestBase = `${req.protocol}://${req.get('host')}`;
    const authUrl = buildHostedAuthUrl({
      requestBase,
      scope: (req.query.scope as string) || '',
      prompt: (req.query.prompt as string) || undefined,
      loginHint: (req.query.login_hint as string) || undefined,
      redirectUriOverride: (req.query.redirect_uri as string) || NYLAS_CALLBACK_URI
    });

    // Default to HTTP redirect; support JSON via ?return=json
    if (req.query.return === 'json') {
      return res.json({ url: authUrl });
    }
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error('Error generating Hosted Auth URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Hosted Auth URL' });
  }
});

// GET /setup/connect-url - Return Hosted Auth URL as JSON (no redirect)
app.get('/setup/connect-url', (req, res) => {
  try {
    const requestBase = `${req.protocol}://${req.get('host')}`;
    const url = buildHostedAuthUrl({
      requestBase,
      scope: (req.query.scope as string) || '',
      prompt: (req.query.prompt as string) || undefined,
      loginHint: (req.query.login_hint as string) || undefined,
      redirectUriOverride: (req.query.redirect_uri as string) || NYLAS_CALLBACK_URI
    });
    res.json({ url });
  } catch (error: any) {
    logger.error('Error building connect URL:', error);
    res.status(500).json({ error: error.message || 'Failed to build connect URL' });
  }
});

// GET /api/nylas-email/callback - OAuth callback to exchange code for grant_id
app.get('/api/nylas-email/callback', async (req, res) => {
  try {
    if (!NYLAS_API_KEY || !NYLAS_CLIENT_ID || !NYLAS_CALLBACK_URI) {
      return res.status(500).json({
        error: 'Server is not configured for Hosted Auth. Set NYLAS_API_KEY, NYLAS_CLIENT_ID, and NYLAS_CALLBACK_URI.'
      });
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code in callback' });
    }

    const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });

    // Use the exact callback URL that the user hit to avoid mismatch
    const requestBase = `${req.protocol}://${req.get('host')}`;
    const effectiveRedirectUri = `${requestBase}${req.path}`;

    // Perform code exchange
    const response = await (nylas as any).auth.exchangeCodeForToken({
      clientSecret: NYLAS_API_KEY,
      clientId: NYLAS_CLIENT_ID,
      redirectUri: effectiveRedirectUri || NYLAS_CALLBACK_URI,
      code
    });

    // Normalized output
    const grantId = response?.grantId || response?.grant_id;
    const email = response?.email || response?.data?.email;

    if (!grantId) {
      return res.status(500).json({ error: 'No grant_id returned from Nylas' });
    }

    // Return the grant so the client can store and inject it on future requests
    res.json({
      success: true,
      grant_id: grantId,
      email,
      message: 'Connected successfully. Store grant_id and start calling the email tools.'
    });
  } catch (error: any) {
    logger.error('OAuth callback error:', error);
    res.status(500).json({ error: error.message || 'Failed to complete OAuth exchange' });
  }
});

// GET /mcp/tools - List available tools
/* Deprecated MCP endpoint removed: use A2A discovery and RPC */
/* app.get('/mcp/tools', (req, res) => {
  const context: RequestContext = res.locals.context;
  const hasCredentials = !!(NYLAS_API_KEY && context.credentials.nylasGrantId);

  // Instrumentation: log credential presence for troubleshooting
  try {
    const maskedGrant = context.credentials.nylasGrantId
      ? `${context.credentials.nylasGrantId.slice(0, 8)}…`
      : 'none';
    console.log(
      `[mcp/tools] env.NYLAS_API_KEY: ${NYLAS_API_KEY ? 'present' : 'missing'}, header.NYLAS_GRANT_ID: ${maskedGrant}, hasCredentials: ${hasCredentials}`
    );
  } catch (_) {
    // no-op
  }

  const tools = [];

  // Only include email tools if credentials are present
  if (hasCredentials) {
    tools.push(
      {
        name: "manage_email",
        description: ManageEmailSchema.description,
        inputSchema: (() => {
          const schema = zodToJsonSchema(ManageEmailSchema) as any;
          // Add context injection annotations for Juli
          if (schema.properties) {
            schema.properties.user_name = {
              ...schema.properties.user_name,
              'x-context-injection': 'user_name'
            };
            schema.properties.user_email = {
              ...schema.properties.user_email,
              'x-context-injection': 'user_email'
            };
          }
          return schema;
        })()
      },
      {
        name: "find_emails",
        description: FindEmailsSchema.description,
        inputSchema: zodToJsonSchema(FindEmailsSchema)
      },
      {
        name: "organize_inbox",
        description: OrganizeInboxSchema.description,
        inputSchema: zodToJsonSchema(OrganizeInboxSchema)
      },
      {
        name: "email_insights",
        description: EmailInsightsSchema.description,
        inputSchema: zodToJsonSchema(EmailInsightsSchema)
      },
      {
        name: "smart_folders",
        description: SmartFoldersSchema.description,
        inputSchema: zodToJsonSchema(SmartFoldersSchema)
      }
    );
  }

  res.json({ tools });
}); */

// POST /mcp/tools/:toolName - Execute a tool
/* Deprecated MCP endpoint removed: use /a2a/rpc */
/* app.post('/mcp/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const { arguments: args } = req.body;
  const context: RequestContext = res.locals.context;

  // Instrumentation: log tool execution with credential presence
  try {
    const maskedGrant = context.credentials.nylasGrantId
      ? `${context.credentials.nylasGrantId.slice(0, 8)}…`
      : 'none';
    console.log(
      `Executing ${toolName} | env.NYLAS_API_KEY: ${NYLAS_API_KEY ? 'present' : 'missing'}, header.NYLAS_GRANT_ID: ${maskedGrant}, user: ${context.userId || 'unknown'}, reqId: ${context.requestId || 'n/a'}`
    );
  } catch (_) {
    // no-op
  }

  try {
    let result: any;

    switch (toolName) {
      case 'manage_email': {
        if (!NYLAS_API_KEY || !context.credentials.nylasGrantId) {
          throw new Error('Missing Nylas credentials. Please connect your email account first.');
        }

        const params = ManageEmailSchema.parse(args) as ManageEmailParams;
        const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
        const emailAI = new EmailAI(); // Uses our server's OpenAI key

        const tool = new ManageEmailTool(
          nylas,
          context.credentials.nylasGrantId,
          emailAI,
          { userName: params.user_name, userEmail: params.user_email }
        );

        result = await tool.execute(params);
        break;
      }

      case 'find_emails': {
        if (!NYLAS_API_KEY || !context.credentials.nylasGrantId) {
          throw new Error('Missing Nylas credentials. Please connect your email account first.');
        }

        const params = FindEmailsSchema.parse(args) as FindEmailsParams;
        const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
        const emailAI = new EmailAI(); // Uses our server's OpenAI key

        const tool = new FindEmailsTool(
          nylas,
          context.credentials.nylasGrantId,
          emailAI
        );

        result = await tool.execute(params);
        break;
      }

      case 'organize_inbox': {
        if (!NYLAS_API_KEY || !context.credentials.nylasGrantId) {
          throw new Error('Missing Nylas credentials. Please connect your email account first.');
        }

        const params = OrganizeInboxSchema.parse(args) as OrganizeInboxParams;
        const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
        const emailAI = new EmailAI(); // Uses our server's OpenAI key

        const tool = new OrganizeInboxTool(
          nylas,
          context.credentials.nylasGrantId,
          emailAI
        );

        result = await tool.execute(params);
        break;
      }

      case 'email_insights': {
        if (!NYLAS_API_KEY || !context.credentials.nylasGrantId) {
          throw new Error('Missing Nylas credentials. Please connect your email account first.');
        }

        const params = EmailInsightsSchema.parse(args) as EmailInsightsParams;
        const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
        const emailAI = new EmailAI(); // Uses our server's OpenAI key

        const tool = new EmailInsightsTool(
          nylas,
          context.credentials.nylasGrantId,
          emailAI
        );

        result = await tool.execute(params);
        break;
      }

      case 'smart_folders': {
        if (!NYLAS_API_KEY || !context.credentials.nylasGrantId) {
          throw new Error('Missing Nylas credentials. Please connect your email account first.');
        }

        const params = SmartFoldersSchema.parse(args) as SmartFoldersParams;
        const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
        const emailAI = new EmailAI(); // Uses our server's OpenAI key

        const tool = new SmartFoldersTool(
          nylas,
          context.credentials.nylasGrantId,
          emailAI
        );

        result = await tool.execute(params);
        break;
      }


      default:
        return res.status(404).json({ error: `Unknown tool: ${toolName}` });
    }

    res.json({ result });

  } catch (error: any) {
    console.error(`Error executing ${toolName}:`, error);

    let errorMessage = error.message;
    let statusCode = 500;

    if (error instanceof z.ZodError) {
      errorMessage = `Input validation error: ${error.errors.map(e =>
        `${e.path.join('.')}: ${e.message}`
      ).join(', ')}`;
      statusCode = 400;
    } else if (error.message.includes('Missing') || error.message.includes('not connected')) {
      statusCode = 401;
    }

    res.status(statusCode).json({
      error: errorMessage,
      code: error.code || 'TOOL_EXECUTION_ERROR'
    });
  }
}); */

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'inbox-mcp',
    version: SERVICE_VERSION,
    transport: 'http'
  });
});

// --- A2A routes ---
app.get('/.well-known/a2a.json', (req, res) => {
  res.json(buildAgentCard(req));
});

function buildCredentialsManifest() {
  return {
    credentials: [
      {
        key: 'EMAIL_ACCOUNT_GRANT',
        display_name: 'Email Account Grant',
        sensitive: true,
        notes: 'Opaque user grant for mailbox access; inject on every execute/approve call.',
        flows: [
          {
            type: 'hosted_auth',
            connect_url: '/setup/connect-url',
            callback: '/api/nylas-email/callback',
            provider_scopes: {
              google: [
                'openid',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/contacts',
                'https://www.googleapis.com/auth/contacts.readonly',
                'https://www.googleapis.com/auth/contacts.other.readonly'
              ],
              microsoft: [
                'Mail.ReadWrite',
                'Mail.Send',
                'Contacts.Read',
                'Contacts.Read.Shared'
              ]
            }
          }
        ]
      }
    ]
  };
}

app.get('/.well-known/a2a-credentials.json', (_req, res) => {
  res.json(buildCredentialsManifest());
});

// Removed REST A2A endpoints; JSON-RPC is the canonical transport.

// --- A2A JSON-RPC 2.0 endpoint (alignment with A2A JSON-RPC transport) ---
// Supported methods:
// - agent.card
// - agent.handshake
// - tool.execute
// - tool.approve
app.post('/a2a/rpc', async (req, res) => {
  const agent = await authenticateAgent(req);
  if (!agent) return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: 401, message: 'unauthorized_agent' } });

  const handleSingle = async (rpcReq: any) => {
    const isNotification = typeof rpcReq?.id === 'undefined';
    const id = isNotification ? null : rpcReq.id;
    const versionOk = rpcReq.jsonrpc === '2.0';
    const method = rpcReq.method as string;
    const params = rpcReq.params || {};
    if (!versionOk || !method) {
      return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } };
    }

    try {
      switch (method) {
        case 'agent.card': {
          return isNotification ? null : { jsonrpc: '2.0', id, result: buildAgentCard(req) };
        }
        case 'agent.handshake': {
          return isNotification ? null : { jsonrpc: '2.0', id, result: { agent: { sub: agent.sub, email: agent.email }, card: buildAgentCard(req), server_time: new Date().toISOString() } };
        }
        case 'tool.execute': {
          const { tool, arguments: args, user_context, request_id } = params;
          const nylasGrantId = user_context?.credentials?.EMAIL_ACCOUNT_GRANT || user_context?.credentials?.NYLAS_GRANT_ID || user_context?.credentials?.nylas_grant_id;
          if (!NYLAS_API_KEY || !nylasGrantId) {
            return isNotification ? null : { jsonrpc: '2.0', id, error: { code: 401, message: 'missing_credentials', data: { hint: '/.well-known/a2a-credentials.json' } } };
          }
          const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
          const emailAI = new EmailAI();
          let result: any;
          switch (tool) {
            case 'manage_email': {
              const typed = ManageEmailSchema.parse(args) as ManageEmailParams;
              const exec = new ManageEmailTool(nylas, nylasGrantId, emailAI, { userName: typed.user_name, userEmail: typed.user_email });
              result = await exec.execute(typed);
              break;
            }
            case 'find_emails': {
              const typed = FindEmailsSchema.parse(args) as FindEmailsParams;
              const exec = new FindEmailsTool(nylas, nylasGrantId, emailAI);
              result = await exec.execute(typed);
              break;
            }
            case 'organize_inbox': {
              const typed = OrganizeInboxSchema.parse(args) as OrganizeInboxParams;
              const exec = new OrganizeInboxTool(nylas, nylasGrantId, emailAI);
              result = await exec.execute(typed);
              break;
            }
            case 'email_insights': {
              const typed = EmailInsightsSchema.parse(args) as EmailInsightsParams;
              const exec = new EmailInsightsTool(nylas, nylasGrantId, emailAI);
              result = await exec.execute(typed);
              break;
            }
            case 'smart_folders': {
              const typed = SmartFoldersSchema.parse(args) as SmartFoldersParams;
              const exec = new SmartFoldersTool(nylas, nylasGrantId, emailAI);
              result = await exec.execute(typed);
              break;
            }
            default:
              return isNotification ? null : { jsonrpc: '2.0', id, error: { code: 404, message: 'unknown_tool', data: { tool } } };
          }
          return isNotification ? null : { jsonrpc: '2.0', id, result: { request_id, result } };
        }
        case 'tool.approve': {
          const { tool, original_arguments, action_data, user_context, request_id } = params;
          const nylasGrantId = user_context?.credentials?.EMAIL_ACCOUNT_GRANT || user_context?.credentials?.NYLAS_GRANT_ID || user_context?.credentials?.nylas_grant_id;
          if (!NYLAS_API_KEY || !nylasGrantId) {
            return isNotification ? null : { jsonrpc: '2.0', id, error: { code: 401, message: 'missing_credentials', data: { hint: '/.well-known/a2a-credentials.json' } } };
          }
          if (tool !== 'manage_email') {
            return isNotification ? null : { jsonrpc: '2.0', id, error: { code: 400, message: 'approval_not_supported_for_tool', data: { tool } } };
          }
          const nylas = new Nylas({ apiKey: NYLAS_API_KEY, apiUri: NYLAS_API_URI });
          const emailAI = new EmailAI();
          const typed = ManageEmailSchema.parse({ ...(original_arguments || {}), approved: true, action_data }) as ManageEmailParams;
          const exec = new ManageEmailTool(nylas, nylasGrantId, emailAI, { userName: typed.user_name, userEmail: typed.user_email });
          const result = await exec.execute(typed);
          return isNotification ? null : { jsonrpc: '2.0', id, result: { request_id, result } };
        }
        default:
          return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params', data: err.errors } };
      }
      return isNotification ? null : { jsonrpc: '2.0', id, error: { code: -32000, message: err?.message || 'Internal error' } };
    }
  };

  const body = req.body;
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(handleSingle));
    const filtered = results.filter((r) => r !== null);
    if (filtered.length === 0) {
      return res.status(204).end();
    }
    return res.json(filtered);
  } else {
    const result = await handleSingle(body);
    if (result === null) {
      return res.status(204).end();
    }
    return res.json(result);
  }
});
// GET /mcp/needs-setup - Check if setup is required
app.get('/setup/status', (req, res) => {
  const context: RequestContext = res.locals.context;
  const hasCredentials = !!(NYLAS_API_KEY && context.credentials.nylasGrantId);
  const requestBase = `${req.protocol}://${req.get('host')}`;
  const defaultConnectUrl = `${requestBase}/setup/connect-url`;

  res.json({
    needs_setup: !hasCredentials,
    has_credentials: hasCredentials,
    setup_url: '/setup/instructions',
    connect_url: defaultConnectUrl
  });
});

// Setup endpoints - separate from MCP tools
app.post('/setup/validate', async (req, res) => {
  try {
    const { nylas_api_key, nylas_grant_id } = req.body;

    if (!nylas_api_key || !nylas_grant_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required credentials: nylas_api_key and nylas_grant_id'
      });
    }

    // Validate credentials using SetupManager
    const setupManager = new SetupManager();
    const result = await setupManager.validateCredentials({
      nylas_api_key,
      nylas_grant_id
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Setup validation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/setup/instructions', (req, res) => {
  res.json({
    type: 'setup_instructions',
    steps: [
      {
        step: 1,
        title: "Create Your Free Nylas Account",
        description: "Nylas provides 5 free email connections - perfect for personal use!",
        action: {
          type: "link",
          label: "Open Nylas Signup",
          url: "https://dashboard-v3.nylas.com/register?utm_source=juli"
        }
      },
      {
        step: 2,
        title: "Get Your API Key",
        description: "After signing in, find your API key in the dashboard",
        details: "Look for 'API Keys' in the left sidebar. The key starts with 'nyk_'"
      },
      {
        step: 3,
        title: "Connect Your Email Account",
        description: "Add your email account to Nylas",
        details: [
          "Click 'Grants' in the sidebar",
          "Click 'Add Test Grant' button",
          "Choose your email provider",
          "Authorize Nylas to access your email",
          "Copy the Grant ID that appears"
        ]
      }
    ],
    next_action: {
      description: "Once you have both credentials, validate them",
      endpoint: "POST /setup/validate",
      body: {
        nylas_api_key: "your_key_here",
        nylas_grant_id: "your_grant_id_here"
      }
    },
    documentation: "https://developer.nylas.com/docs/v3/"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Inbox MCP HTTP server running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  GET  /health - Health check`);
  console.log(`  GET  /setup/status - Check if setup is required`);
  console.log(`  GET  /setup/instructions - Get setup instructions`);
  console.log(`  POST /setup/validate - Validate Nylas credentials`);
});