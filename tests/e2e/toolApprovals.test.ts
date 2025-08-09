import { HttpTestClient, createTestClient, startTestServer } from './utils/httpClient';
import { TestLogger } from './utils/testLogger';
import { E2E_CONFIG } from './config';
import { hasNylasCredentials } from './utils/config';

const SKIP = !hasNylasCredentials() || !process.env.OPENAI_API_KEY;
const suite = SKIP ? describe.skip : describe;

suite('Tool Approval Flows', () => {
  let client: HttpTestClient;
  let server: { port: number; stop: () => Promise<void> };
  const logger = new TestLogger();

  // Track created resources for cleanup
  const testEmailIds: string[] = [];
  const testFolderIds: string[] = [];

  beforeAll(async () => {
    logger.logSection('TEST SUITE INITIALIZATION');

    // Validate environment
    const hasCredentials = !!E2E_CONFIG.nylas.grantId;
    if (!hasCredentials) return; // suite is skipped when missing

    // Start test server
    logger.logInfo('Starting test server...');
    server = await startTestServer();

    // Create test client with credentials
    client = createTestClient({
      port: server.port,
      credentials: {
        nylasGrantId: E2E_CONFIG.nylas.grantId
      }
    });

    logger.logSuccess(`Test server started on port ${server.port}`);
  }, 30000);

  afterAll(async () => {
    logger.logSection('CLEANUP');

    // Cleanup test emails
    if (testEmailIds.length > 0 && E2E_CONFIG.testData.cleanupAfterTests) {
      logger.logInfo(`Cleaning up ${testEmailIds.length} test emails...`);
      
      // Delete test emails using Nylas API
      try {
        const Nylas = (await import('nylas')).default;
        const nylas = new Nylas({ 
          apiKey: process.env.NYLAS_API_KEY!, 
          apiUri: process.env.NYLAS_API_URI || 'https://api.us.nylas.com' 
        });
        
        for (const emailId of testEmailIds) {
          try {
            await nylas.messages.destroy({
              identifier: E2E_CONFIG.nylas!.grantId,
              messageId: emailId
            });
            logger.logSuccess(`Deleted test email: ${emailId}`);
          } catch (error) {
            logger.logWarning(`Failed to delete email ${emailId}: ${error}`);
          }
        }
      } catch (error) {
        logger.logWarning(`Failed to cleanup test emails: ${error}`);
      }
    }

    // Stop server
    if (server) {
      await server.stop();
      logger.logSuccess('Test server stopped');
    }
  });

  describe('manage_email approval flow', () => {
    test('should require approval for sending email', async () => {
      logger.logStep(1, 'Test manage_email approval flow');

      if (!E2E_CONFIG.nylas.testEmail) {
        logger.logWarning('Skipping - TEST_EMAIL_ADDRESS not set');
        return;
      }

      // Step 1: Initial request that should require approval
      const initialResponse = await client.callTool('manage_email', {
        action: 'send',
        query: `Send an email to ${E2E_CONFIG.nylas.testEmail} with subject "${E2E_CONFIG.testData.emailPrefix} Approval Test" saying "This is a test of the approval system"`
      });

      // Verify approval is required
      expect(initialResponse.result.needs_approval).toBe(true);
      expect(initialResponse.result.action_type).toBe('send_email');
      expect(initialResponse.result.action_data).toBeDefined();
      expect(initialResponse.result.preview).toBeDefined();
      expect(initialResponse.result.preview.summary).toContain(E2E_CONFIG.nylas.testEmail);

      logger.logSuccess('Email send requires approval as expected');
      logger.logData('Approval Preview', initialResponse.result.preview, 2);

      // Step 2: Execute with approval
      const approvalResponse = await client.approveAction(
        'manage_email',
        initialResponse.result.action_data.original_params,
        initialResponse.result.action_data
      );

      expect(approvalResponse.result.success).toBe(true);
      expect(approvalResponse.result.message_id).toBeDefined();

      if (approvalResponse.result?.message_id) {
        testEmailIds.push(approvalResponse.result.message_id);
      }

      logger.logSuccess('Email sent successfully after approval');
    }, 60000);

    test('should skip approval when require_approval is false', async () => {
      logger.logStep(2, 'Test manage_email without approval');

      if (!E2E_CONFIG.nylas.testEmail) {
        logger.logWarning('Skipping - TEST_EMAIL_ADDRESS not set');
        return;
      }

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: `Send an email to ${E2E_CONFIG.nylas.testEmail} with subject "${E2E_CONFIG.testData.emailPrefix} No Approval Test"`,
        require_approval: false
      });

      // Should send directly without approval
      expect(response.result.needs_approval).toBeUndefined();
      expect(response.result.success).toBe(true);
      expect(response.result.message_id).toBeDefined();

      if (response.result?.message_id) {
        testEmailIds.push(response.result.message_id);
      }

      logger.logSuccess('Email sent directly without approval');
    }, 60000);
  });

  describe('organize_inbox approval flow', () => {
    test('should require approval for inbox organization', async () => {
      logger.logStep(3, 'Test organize_inbox approval flow');

      // Step 1: Initial request with dry_run=false should require approval
      const initialResponse = await client.callTool('organize_inbox', {
        instruction: 'Archive all emails older than 30 days that are not starred',
        scope: {
          folder: 'inbox',
          limit: 10
        },
        dry_run: false
      });

      // Verify response - may not need approval if no actions to take
      if (initialResponse.result.needs_approval) {
        expect(initialResponse.result.action_type).toBe('organize_inbox');
        expect(initialResponse.result.action_data).toBeDefined();
        expect(initialResponse.result.preview).toBeDefined();
        expect(initialResponse.result.preview.summary).toBeDefined();
      } else {
        // No emails matched the criteria
        expect(initialResponse.result.total_actions).toBe(0);
      }

      if (initialResponse.result.needs_approval) {
        logger.logSuccess('Inbox organization requires approval as expected');
        logger.logData('Organization Preview', initialResponse.result.preview, 2);
      } else {
        logger.logInfo('No emails matched organization criteria');
      }

      // Note: We won't execute the approval in tests to avoid modifying real inbox
      logger.logInfo('Skipping actual execution to preserve inbox state');
    }, 60000);

    test('should return preview only when dry_run is true', async () => {
      logger.logStep(4, 'Test organize_inbox dry run');

      const response = await client.callTool('organize_inbox', {
        instruction: 'Move all newsletters to a Newsletter folder',
        scope: {
          folder: 'inbox',
          limit: 20
        },
        dry_run: true
      });

      // Should return preview without requiring approval
      expect(response.result.needs_approval).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result.preview_actions).toBeDefined();
      expect(response.result.total_actions).toBeDefined();

      logger.logSuccess('Dry run returned preview without approval');
      logger.logData('Dry Run Results', {
        total_actions: response.result.total_actions || 0,
        summary: response.result.summary
      }, 2);
    }, 60000);
  });

  describe('smart_folders approval flow', () => {
    test('should require approval for applying smart folder rules', async () => {
      logger.logStep(5, 'Test smart_folders approval flow');

      // First create a smart folder rule with unique name
      const uniqueFolderName = `${E2E_CONFIG.testData.emailPrefix} Test Smart Folder ${Date.now()}`;
      const createResponse = await client.callTool('smart_folders', {
        query: 'Create a folder for important client emails from domains like @important-client.com',
        folder_name: uniqueFolderName
      });

      // Handle both success and conflict cases
      if (createResponse.error) {
        // If folder already exists, that's okay for this test
        logger.logInfo(`Folder creation failed (may already exist): ${createResponse.error}`);
        // Try to list existing folders instead
        const listResponse = await client.callTool('smart_folders', {
          query: 'show me all my smart folders'
        });
        expect(listResponse.result.smart_folders).toBeDefined();
      } else {
        expect(createResponse.result.success).toBe(true);
        expect(createResponse.result.folder_id).toBeDefined();

        if (createResponse.result?.folder_id) {
          testFolderIds.push(createResponse.result.folder_id);
        }
      }

      // Step 2: Apply the folder with dry_run=false should require approval
      const applyResponse = await client.callTool('smart_folders', {
        query: `Apply the "${uniqueFolderName}" rules`,
        dry_run: false
      });

      // Handle both cases: approval required (emails to move) or no emails to move
      if (applyResponse.result.needs_approval) {
        // Case 1: There are emails to move, approval required
        expect(applyResponse.result.action_type).toBe('apply_smart_folder');
        expect(applyResponse.result.action_data).toBeDefined();
        expect(applyResponse.result.preview).toBeDefined();
        logger.logSuccess('Smart folder application requires approval as expected');
        logger.logData('Smart Folder Preview', applyResponse.result.preview, 2);
      } else if (applyResponse.result.success && applyResponse.result.preview) {
        // Case 2: No emails match the criteria, so no approval needed
        expect(applyResponse.result.preview.total_count).toBe(0);
        logger.logInfo('No emails matched smart folder criteria, approval not required');
        logger.logData('Smart Folder Preview', applyResponse.result.preview, 2);
      } else {
        // Unexpected response
        throw new Error(`Unexpected response: ${JSON.stringify(applyResponse)}`);
      }

      // Note: We won't execute the approval in tests to avoid moving real emails
      logger.logInfo('Test completed - preserving inbox state');
    }, 60000);

    test('should return preview when listing smart folders', async () => {
      logger.logStep(6, 'Test smart_folders list action');

      const response = await client.callTool('smart_folders', {
        query: 'show me all my smart folders'
      });

      // List action should not require approval
      expect(response.result.needs_approval).toBeUndefined();
      expect(response.result.smart_folders).toBeDefined();
      expect(Array.isArray(response.result.smart_folders)).toBe(true);

      logger.logSuccess('Listed smart folders without approval');
      logger.logData('Smart Folders', {
        count: response.result.smart_folders.length,
        folders: response.result.smart_folders.map((f: any) => f.name)
      }, 2);
    }, 60000);
  });

  describe('Approval edge cases', () => {
    test('should handle approval with missing action_data', async () => {
      logger.logStep(7, 'Test approval with invalid data');

      const response = await client.callTool('manage_email', {
        action: 'send',
        query: 'test',
        approved: true,
        // Missing action_data
      });

      // When approved is true but action_data is missing, it processes as a new request
      // and returns needs_approval instead of executing
      expect(response.result).toBeDefined();
      expect(response.result.needs_approval).toBe(true);
      expect(response.result.action_type).toBe('send_email');

      logger.logSuccess('Properly handled missing action_data by requiring approval');
    });

    test('should handle approval with minimal but valid action_data', async () => {
      logger.logStep(8, 'Test approval with minimal action_data');

      if (!E2E_CONFIG.nylas.testEmail) {
        logger.logWarning('Skipping - TEST_EMAIL_ADDRESS not set');
        return;
      }

      // Test with minimal but valid action_data
      const response = await client.callTool('manage_email', {
        action: 'send',
        query: 'test',
        approved: true,
        action_data: {
          email_content: {
            to: [E2E_CONFIG.nylas.testEmail],
            subject: `${E2E_CONFIG.testData.emailPrefix} Minimal Test`,
            body: 'Test email with minimal data'
          },
          original_params: {
            action: 'send',
            query: 'test'
          }
        }
      });

      // With valid action_data, the email should be sent successfully
      expect(response.result?.success).toBe(true);
      expect(response.result?.message_id).toBeDefined();

      if (response.result?.message_id) {
        testEmailIds.push(response.result.message_id);
      }

      logger.logSuccess('Successfully handled approval with minimal data');
    });
  });
});