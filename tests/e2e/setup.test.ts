import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpTestClient, startTestServer, createTestClient } from './utils/httpClient';
import { E2E_CONFIG, hasNylasCredentials } from './utils/config';
import Nylas from 'nylas';

describe('Setup and Onboarding E2E Tests', () => {
  let server: { port: number; stop: () => Promise<void> };
  let client: HttpTestClient;
  
  beforeAll(async () => {
    if (process.env.USE_EXISTING_SERVER !== 'true') {
      server = await startTestServer();
      E2E_CONFIG.server.port = server.port;
    }
    
    client = createTestClient({
      port: E2E_CONFIG.server.port,
      credentials: E2E_CONFIG.nylas
    });
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Initial Setup Flow', () => {
    it('should indicate setup is needed when not configured', async () => {
      // Create a client without credentials
      const setupClient = createTestClient({
        port: E2E_CONFIG.server.port
        // No credentials provided
      });

      // Check if setup is needed
      const needsSetupResponse = await setupClient.get('/mcp/needs-setup');
      
      expect(needsSetupResponse.needs_setup).toBe(true);
      expect(needsSetupResponse.has_credentials).toBe(false);
      expect(needsSetupResponse.setup_url).toBe('/setup/instructions');
    });

    it('should provide detailed setup instructions', async () => {
      const setupClient = createTestClient({
        port: E2E_CONFIG.server.port
      });

      // Get setup instructions
      const response = await setupClient.get('/setup/instructions');

      expect(response.type).toBe('setup_instructions');
      expect(response.steps).toHaveLength(3);
      
      // Verify step structure
      const firstStep = response.steps[0];
      expect(firstStep.title).toContain('Nylas Account');
      expect(firstStep.action).toBeDefined();
      
      // Verify next action
      expect(response.next_action).toBeDefined();
      expect(response.next_action.endpoint).toBe('POST /setup/validate');
    });

    it('should validate credential format', async () => {
      const setupClient = createTestClient({
        port: E2E_CONFIG.server.port
      });

      // Test invalid API key format
      const invalidResponse = await setupClient.post('/setup/validate', {
        nylas_api_key: 'invalid_key',
        nylas_grant_id: '12345678-1234-1234-1234-123456789012'
      });

      expect(invalidResponse.type).toBe('validation_error');
      expect(invalidResponse.message).toContain('API key should start with');
    });

    it('should handle missing credentials', async () => {
      const setupClient = createTestClient({
        port: E2E_CONFIG.server.port
      });

      // Test missing credentials
      const response = await setupClient.post('/setup/validate', {});

      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required credentials');
    });
  });

  describe('Credential Validation', () => {
    it('should validate credentials if provided', async () => {
      if (!hasNylasCredentials()) {
        console.log('Skipping credential validation - no Nylas credentials provided');
        return;
      }

      const response = await client.post('/setup/validate', {
        nylas_api_key: E2E_CONFIG.nylas!.nylasAccessToken,
        nylas_grant_id: E2E_CONFIG.nylas!.nylasGrantId
      });

      if (response.type === 'setup_success') {
        expect(response.credentials_validated).toBe(true);
        expect(response.message).toContain('Successfully connected');
      } else {
        // If credentials are invalid, should get appropriate error
        expect(['setup_error', 'validation_error']).toContain(response.type);
      }
    });
  });


  describe('Tool Availability Based on Setup', () => {
    it('should show all tools when properly configured', async () => {
      if (!hasNylasCredentials()) {
        console.log('Skipping tool availability test - no Nylas credentials provided');
        return;
      }

      const response = await client.listTools();
      
      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBeGreaterThan(0);
      
      // Should have email tools available
      const emailTools = ['manage_email', 'find_emails', 'organize_inbox', 'email_insights', 'smart_folders'];
      emailTools.forEach(toolName => {
        const tool = response.tools.find((t: any) => t.name === toolName);
        expect(tool).toBeDefined();
      });
    });

    it('should show no tools when not configured', async () => {
      const unconfiguredClient = createTestClient({
        port: E2E_CONFIG.server.port
        // No credentials
      });

      const response = await unconfiguredClient.listTools();
      
      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBe(0); // No MCP tools without credentials
      
      // Setup is not an MCP tool - it's a separate endpoint
      const setupTool = response.tools.find((t: any) => t.name === 'setup_email_connection');
      expect(setupTool).toBeUndefined();
    });
  });
});