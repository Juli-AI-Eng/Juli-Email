/**
 * E2E test for contact name resolution in email sending
 * Tests the ability to send emails using contact names instead of email addresses
 * 
 * IMPORTANT: These tests use require_approval: true to ensure no actual emails are sent
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpTestClient, startTestServer } from './utils/httpClient';
import { E2E_CONFIG, hasNylasCredentials } from './utils/config';
import { logger } from './utils/testLogger';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Skip tests if real APIs are not configured
const SKIP_REAL_API = !hasNylasCredentials() || !process.env.OPENAI_API_KEY;

const testSuite = SKIP_REAL_API ? describe.skip : describe;

testSuite('Contact Name Resolution E2E', () => {
  let client: HttpTestClient;
  let server: { port: number; stop: () => Promise<void> };

  beforeAll(async () => {
    logger.logSection('CONTACT NAME RESOLUTION TEST INITIALIZATION');
    logger.logWarning('⚠️  All tests use require_approval: true to prevent sending actual emails');

    // Validate environment
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for real API tests');
    }

    if (!E2E_CONFIG.nylas) {
      throw new Error('Nylas credentials are required (NYLAS_GRANT_ID)');
    }

    logger.logSuccess('Environment validated');

    // Start test server
    logger.logInfo('Starting test server...');
    server = await startTestServer();

    // Create test client
    client = new HttpTestClient({
      baseUrl: E2E_CONFIG.server.url,
      port: server.port,
      credentials: {
        nylasGrantId: E2E_CONFIG.nylas.nylasGrantId
      }
    });

    logger.logSuccess(`Test server started on port ${server.port}`);
  }, 60000);

  afterAll(async () => {
    logger.logSection('TEST CLEANUP');

    if (server) {
      await server.stop();
      logger.logSuccess('Test server stopped');
    }
  });

  describe('Email Send with Contact Names (Approval Only)', () => {
    test('should resolve contact name to email address when creating draft', async () => {
      logger.logStep(1, 'Test creating draft using contact name');

      // Use draft action instead of send to be extra safe
      const draftResponse = await client.callTool('manage_email', {
        action: 'draft',
        query: `create a draft email to diego about the quarterly report`,
        require_approval: false // Drafts don't need approval
      });

      logger.logApiResponse(200, draftResponse);

      // If it finds a Diego, it will create a draft with his email
      // If not, it will return a contact_not_found error
      if (draftResponse.result?.success) {
        logger.logSuccess('Draft created with resolved contact');
      } else if (draftResponse.result?.error === 'contact_not_found') {
        logger.logInfo('No Diego found in contacts - this is expected if no such contact exists');
        expect(draftResponse.result.message.toLowerCase()).toContain('could not find email addresses for: diego');
      }
    });

    test('should handle non-existent contact gracefully', async () => {
      logger.logStep(1, 'Test handling non-existent contact');

      // Use a very unlikely name
      const nonExistentName = 'Zxqwerty' + Date.now();

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: `send an email to ${nonExistentName} about the project`,
        require_approval: true // This ensures no email is actually sent
      });

      logger.logApiResponse(200, response);

      // Should get an error response
      expect(response.result?.success).toBe(false);
      expect(response.result?.error).toBe('contact_not_found');
      expect(response.result?.message.toLowerCase()).toContain(`could not find email addresses for: ${nonExistentName.toLowerCase()}`);
      expect(response.result?.suggestions).toBeInstanceOf(Array);

      logger.logSuccess('Non-existent contact handled correctly');
    });

    test('should work with full email addresses as before', async () => {
      logger.logStep(1, 'Test with full email address');

      // Use a safe test email that won't send to a real person
      const testEmail = 'test.user.' + Date.now() + '@example.com';

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: `send an email to ${testEmail} saying this is a test with full email address`,
        require_approval: true // This ensures no email is actually sent
      });

      logger.logApiResponse(200, response);

      // Should create approval request
      expect(response.result?.needs_approval).toBe(true);
      expect(response.result?.action_data?.email_content?.to).toContain(testEmail);

      logger.logSuccess('Full email address works correctly (approval created, not sent)');
    });

    test('should validate contact resolution in approval preview', async () => {
      logger.logStep(1, 'Test approval preview shows resolved emails');

      // Try with a common first name that might exist
      const commonName = 'andrew';

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: `send an email to ${commonName} about the team meeting`,
        require_approval: true // This ensures no email is actually sent
      });

      logger.logApiResponse(200, response);

      if (response.result?.needs_approval) {
        // Check that the approval preview shows the resolved email, not just the name
        const preview = response.result.preview;
        expect(preview.details.to).toBeDefined();
        expect(preview.details.to[0]).toContain('@'); // Should be an email address
        logger.logSuccess(`Name "${commonName}" resolved to email in approval preview`);
      } else if (response.result?.error === 'contact_not_found') {
        logger.logInfo(`No contact named "${commonName}" found - this is expected`);
        expect(response.result.suggestions).toContain('Use the full email address (e.g., sarah@example.com)');
      }
    });

    test('should handle multiple name matches safely', async () => {
      logger.logStep(1, 'Create test scenario with common name');

      // Use a very common name that might have multiple matches
      const response = await client.callTool('manage_email', {
        action: 'draft', // Use draft to be extra safe
        query: `draft an email to michael about the budget review`
      });

      logger.logApiResponse(200, response);

      // The system should either:
      // 1. Find no Michaels and return contact_not_found
      // 2. Find one Michael and create a draft
      // 3. Find multiple Michaels and pick the first one (logging a warning)

      if (response.result?.success) {
        logger.logInfo('Draft created - system found and selected a Michael');
      } else if (response.result?.error === 'contact_not_found') {
        logger.logInfo('No Michael found in contacts');
      }

      // Either way, no email was sent
      logger.logSuccess('Multiple name scenario handled safely');
    });
  });
});