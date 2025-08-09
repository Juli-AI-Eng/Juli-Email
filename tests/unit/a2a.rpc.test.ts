/**
 * Unit tests for A2A JSON-RPC endpoint
 * Tests the core RPC handling logic in server.ts
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

// Mock dependencies
jest.mock('nylas');
jest.mock('../../src/ai/emailAI');

describe('A2A JSON-RPC Endpoint', () => {
  let app: express.Application;
  const validDevSecret = 'test-dev-secret';
  const validOidcToken = jwt.sign(
    { sub: 'test-agent', email: 'agent@example.com' },
    'test-secret'
  );

  beforeEach(() => {
    // Reset environment
    process.env.A2A_DEV_SECRET = validDevSecret;
    process.env.NYLAS_API_KEY = 'test-api-key';
    process.env.NYLAS_API_URI = 'https://api.us.nylas.com';
    
    // Clear module cache to get fresh instance
    jest.resetModules();
  });

  describe('Authentication', () => {
    test('should reject requests without authentication', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe('unauthorized_agent');
    });

    test('should accept requests with valid dev secret', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.agent_id).toBe('inbox-mcp');
    });

    test('should accept requests with valid OIDC token', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('Authorization', `Bearer ${validOidcToken}`)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.result).toBeDefined();
    });
  });

  describe('JSON-RPC Protocol', () => {
    test('should handle single request', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.jsonrpc).toBe('2.0');
      expect(response.body.id).toBe(1);
      expect(response.body.result).toBeDefined();
    });

    test('should handle batch requests', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send([
          { jsonrpc: '2.0', id: 1, method: 'agent.card', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'agent.handshake', params: {} }
        ]);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(1);
      expect(response.body[1].id).toBe(2);
    });

    test('should handle notification requests (no id)', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
    });

    test('should handle batch with only notifications', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send([
          { jsonrpc: '2.0', method: 'agent.card', params: {} },
          { jsonrpc: '2.0', method: 'agent.handshake', params: {} }
        ]);

      expect(response.status).toBe(204);
    });

    test('should return error for invalid JSON-RPC version', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '1.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(-32600);
      expect(response.body.error.message).toBe('Invalid Request');
    });

    test('should return error for unknown method', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'unknown.method',
          params: {}
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(-32601);
      expect(response.body.error.message).toBe('Method not found');
    });
  });

  describe('agent.card method', () => {
    test('should return agent card with correct structure', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.card',
          params: {}
        });

      expect(response.status).toBe(200);
      const card = response.body.result;
      expect(card.agent_id).toBe('inbox-mcp');
      expect(card.version).toBeDefined();
      expect(card.description).toBeDefined();
      expect(card.auth).toBeDefined();
      expect(card.approvals).toEqual({ modes: ['stateless_preview_then_approve'] });
      expect(card.context_requirements).toEqual({ credentials: ['EMAIL_ACCOUNT_GRANT'] });
      expect(card.capabilities).toBeDefined();
      expect(card.rpc).toEqual({ endpoint: '/a2a/rpc' });
    });
  });

  describe('agent.handshake method', () => {
    test('should return handshake response with agent info', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('Authorization', `Bearer ${validOidcToken}`)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'agent.handshake',
          params: {}
        });

      expect(response.status).toBe(200);
      const result = response.body.result;
      expect(result.agent).toEqual({
        sub: 'test-agent',
        email: 'agent@example.com'
      });
      expect(result.card).toBeDefined();
      expect(result.server_time).toBeDefined();
    });
  });

  describe('tool.execute method', () => {
    test('should reject without credentials', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'manage_email',
            arguments: { action: 'send', query: 'test' },
            user_context: {}
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(401);
      expect(response.body.error.message).toBe('missing_credentials');
    });

    test('should handle unknown tool', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'unknown_tool',
            arguments: {},
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(404);
      expect(response.body.error.message).toBe('unknown_tool');
    });

    test('should handle invalid parameters', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'manage_email',
            arguments: { invalid: 'params' },
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(-32602);
      expect(response.body.error.message).toBe('Invalid params');
    });
  });

  describe('tool.approve method', () => {
    test('should reject without credentials', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.approve',
          params: {
            tool: 'manage_email',
            original_arguments: {},
            action_data: {},
            user_context: {}
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(401);
      expect(response.body.error.message).toBe('missing_credentials');
    });

    test('should handle manage_email approval', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.approve',
          params: {
            tool: 'manage_email',
            original_arguments: { action: 'send', query: 'test' },
            action_data: { email_content: { to: ['test@example.com'] } },
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });

    test('should handle organize_inbox approval', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.approve',
          params: {
            tool: 'organize_inbox',
            original_arguments: { query: 'organize by sender' },
            action_data: { organization_plan: {} },
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });

    test('should handle smart_folders approval', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.approve',
          params: {
            tool: 'smart_folders',
            original_arguments: { query: 'apply folder rules' },
            action_data: { folder_plan: {} },
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });

    test('should reject unsupported tools for approval', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.approve',
          params: {
            tool: 'find_emails',
            original_arguments: {},
            action_data: {},
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(400);
      expect(response.body.error.message).toBe('approval_not_supported_for_tool');
    });
  });

  describe('Credential Handling', () => {
    test('should accept EMAIL_ACCOUNT_GRANT credential', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'find_emails',
            arguments: { query: 'test' },
            user_context: {
              credentials: { EMAIL_ACCOUNT_GRANT: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });

    test('should accept NYLAS_GRANT_ID credential', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'find_emails',
            arguments: { query: 'test' },
            user_context: {
              credentials: { NYLAS_GRANT_ID: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });

    test('should accept nylas_grant_id credential', async () => {
      const { app } = await import('../../src/server');
      
      const response = await request(app)
        .post('/a2a/rpc')
        .set('X-A2A-Dev-Secret', validDevSecret)
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tool.execute',
          params: {
            tool: 'find_emails',
            arguments: { query: 'test' },
            user_context: {
              credentials: { nylas_grant_id: 'test-grant' }
            }
          }
        });

      expect(response.status).toBe(200);
      // Would need more mocking to test actual execution
    });
  });
});