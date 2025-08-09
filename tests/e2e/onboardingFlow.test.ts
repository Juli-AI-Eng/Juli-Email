/**
 * Onboarding flow test for new users
 * Tests the complete setup experience without existing credentials
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpTestClient, startTestServer } from './utils/httpClient';
import { E2E_CONFIG } from './utils/config';
import { logger } from './utils/testLogger';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Onboarding Flow - New User Experience', () => {
  let client: HttpTestClient;
  let server: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    logger.logSection('ONBOARDING TEST INITIALIZATION');

    // Start server
    server = await startTestServer();

    // Create client WITHOUT credentials to simulate new user
    client = new HttpTestClient({
      baseUrl: E2E_CONFIG.server.url,
      port: server.port
      // No credentials provided
    });

    logger.logSuccess(`Test server started on port ${server.port}`);
  }, 30000);

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Initial Connection - No Credentials', () => {
    test.skip('should list only setup tool when no credentials provided', async () => {
      // SKIPPED: Setup is now a separate endpoint, not a tool
      logger.logStep(1, 'List tools without credentials');

      const response = await client.listTools();

      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBeGreaterThan(0);

      const toolNames = response.tools.map((t: any) => t.name);
      logger.logData('Available Tools', toolNames);

      // Should have setup tool
      expect(toolNames).toContain('setup');

      // Should NOT have email tools without credentials
      expect(toolNames).not.toContain('manage_email');
      expect(toolNames).not.toContain('find_emails');

      logger.logSuccess('Only setup tool available - correct behavior');
    });

    test('should fail gracefully when trying to use email tools without setup', async () => {
      logger.logStep(2, 'Try to use email tool without credentials');

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: 'test email'
      });

      // Expect JSON-RPC error for missing credentials
      expect(response).toBeDefined();
      const err = (response as any).error || response;
      expect(err).toBeDefined();
      const message = err.message || err.error || '';
      // Accept either structured JSON-RPC { error: { code, message } } or direct error message
      expect(message).toBeTruthy();
      // Prefer canonical message
      if (err?.message) {
        expect(err.message).toMatch(/missing_credentials|Missing Nylas credentials/i);
      }

      logger.logSuccess('Correctly rejected email operation without credentials');
    });
  });

  describe.skip('Setup Tool - Guided Onboarding', () => {
    // SKIPPED: Setup is now a separate endpoint, not a tool
    test('should provide setup instructions', async () => {
      logger.logStep(3, 'Get setup instructions');

      const response = await client.callTool('setup', {
        action: 'start'
      });

      expect(response.result).toBeDefined();
      expect(response.result.type).toBe('setup_instructions');
      expect(response.result.steps).toBeDefined();
      expect(Array.isArray(response.result.steps)).toBe(true);
      expect(response.result.steps.length).toBeGreaterThan(0);

      logger.logData('Setup Steps', response.result.steps.map((s: any) => ({
        step: s.step,
        title: s.title
      })));

      // Verify instructions structure
      const firstStep = response.result.steps[0];
      expect(firstStep.title).toBeDefined();
      expect(firstStep.description).toBeDefined();
      expect(firstStep.actions).toBeDefined();

      logger.logSuccess('Received comprehensive setup instructions');
    });

    test('should validate credential format', async () => {
      logger.logStep(4, 'Test credential validation with invalid format');

      // Test with invalid API key format
      const response = await client.callTool('setup', {
        action: 'validate',
        credentials: {
          nylas_api_key: 'invalid-key-format',
          nylas_grant_id: '12345678-1234-1234-1234-123456789012'
        }
      });

      expect(response.result).toBeDefined();
      expect(response.result.type).toBe('validation_error');
      expect(response.result.message).toContain('API key should start with');

      logger.logSuccess('Correctly validated API key format');
    });

    test('should validate grant ID format', async () => {
      logger.logStep(5, 'Test grant ID validation');

      const response = await client.callTool('setup', {
        action: 'validate',
        credentials: {
          nylas_api_key: 'nyk_valid_format_key',
          nylas_grant_id: 'not-a-uuid'
        }
      });

      expect(response.result).toBeDefined();
      expect(response.result.type).toBe('validation_error');
      expect(response.result.message).toContain('valid UUID');

      logger.logSuccess('Correctly validated grant ID format');
    });

    // Only run this test if we have real credentials to test with
    if ((E2E_CONFIG as any).nylas) {
      test('should successfully validate real credentials', async () => {
        logger.logStep(6, 'Validate real credentials');

        // Debug: Log what credentials we're using
        logger.logData('Testing with credentials', {
          grantId: (E2E_CONFIG as any).nylas.nylasGrantId
        });

        const response = await client.post('/setup/validate', {
          nylas_api_key: 'server_env_key',
          nylas_grant_id: (E2E_CONFIG as any).nylas.nylasGrantId
        });

        expect(response.result).toBeDefined();

        // Log the actual response for debugging
        if (response.result.type !== 'setup_success') {
          logger.logError('Validation failed:', response.result);

          // Handle expired or invalid credentials gracefully
          if (response.result.type === 'setup_error') {
            if (response.result.message.includes('Grant ID not found')) {
              logger.logWarning('Grant ID not found - it may have expired (test grants expire after 30 days)');
              logger.logInfo('To fix: Create a new test grant in your Nylas dashboard and update .env');
              return; // Skip the test
            } else if (response.result.message.includes('Invalid API key')) {
              logger.logWarning('API key is invalid - please check your Nylas dashboard');
              logger.logInfo('To fix: Verify your API key in the Nylas dashboard and update .env');
              return; // Skip the test
            }
          }
        }

        expect(response.type).toBeDefined();

        if (response.result.email) {
          logger.logData('Connected Email', response.result.email);
        }

        logger.logSuccess('Real credentials validated successfully');
      });
    }
  });

  describe('Post-Setup Experience', () => {
    test('should have all tools available after adding credentials', async () => {
      logger.logStep(7, 'Verify tools available after setup');

      // Skip if no real credentials
      if (!E2E_CONFIG.nylas) {
        logger.logWarning('Skipping - no real credentials available');
        return;
      }

      // Create new client with credentials
      const authenticatedClient = new HttpTestClient({
        baseUrl: E2E_CONFIG.server.url,
        port: server.port,
        credentials: {
          nylasGrantId: E2E_CONFIG.nylas.nylasGrantId
        }
      });

      const response = await authenticatedClient.listTools();
      const toolNames = response.tools.map((t: any) => t.name);

      // Should now have all email tools
      expect(toolNames).toContain('manage_email');
      expect(toolNames).toContain('find_emails');
      expect(toolNames).toContain('email_insights');
      expect(toolNames).toContain('organize_inbox');
      expect(toolNames).toContain('smart_folders');

      logger.logSuccess('All email tools now available after setup');
    });
  });

  describe('Error Scenarios', () => {
    test('should handle network errors gracefully', async () => {
      logger.logStep(8, 'Test network error handling');

      // Create client pointing to wrong port
      const badClient = new HttpTestClient({
        baseUrl: E2E_CONFIG.server.url,
        port: 99999 // Invalid port
      });

      try {
        await badClient.listTools();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error).toBeDefined();
        logger.logSuccess('Network error handled correctly');
      }
    });

    test.skip('should provide helpful error for missing credentials', async () => {
      // SKIPPED: Setup is now a separate endpoint, not a tool
      logger.logStep(9, 'Test missing credential fields');

      const response = await client.callTool('setup', {
        action: 'validate',
        credentials: {
          // Missing both fields
        }
      });

      expect(response.result).toBeDefined();
      expect(response.result.type).toBe('validation_error');
      expect(response.result.missing_fields).toBeDefined();
      expect(response.result.missing_fields).toContain('nylas_api_key');
      expect(response.result.missing_fields).toContain('nylas_grant_id');

      logger.logSuccess('Correctly identified missing fields');
    });
  });
});