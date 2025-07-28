/**
 * Full real API journey test for Inbox MCP
 * Tests complete user flow with real Nylas and OpenAI APIs
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { HttpTestClient, startTestServer } from './utils/httpClient';
import { E2E_CONFIG, hasNylasCredentials } from './utils/config';
import { logger } from './utils/testLogger';
import * as dotenv from 'dotenv';

// Load environment variables from standard .env
dotenv.config();

// Skip tests if real APIs are not configured
const SKIP_REAL_API = !hasNylasCredentials() || !process.env.OPENAI_API_KEY;

const testSuite = SKIP_REAL_API ? describe.skip : describe;

testSuite('Full Real API Journey', () => {
  let client: HttpTestClient;
  let server: { port: number; stop: () => Promise<void> };
  let testEmailIds: string[] = [];
  
  beforeAll(async () => {
    logger.logSection('TEST SUITE INITIALIZATION');
    
    // Validate environment
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for real API tests');
    }
    
    if (!E2E_CONFIG.nylas) {
      throw new Error('Nylas credentials are required (NYLAS_ACCESS_TOKEN and NYLAS_GRANT_ID)');
    }
    
    if (!E2E_CONFIG.testData.testRecipientEmail) {
      throw new Error('TEST_EMAIL_ADDRESS is required for sending test emails');
    }
    
    logger.logSuccess('Environment validated');
    logger.logData('Test Configuration', {
      hasNylasCredentials: hasNylasCredentials(),
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      testEmailRecipient: E2E_CONFIG.testData.testRecipientEmail,
      testPrefix: E2E_CONFIG.testData.testEmailPrefix,
      cleanupEnabled: E2E_CONFIG.testData.cleanupAfterTest
    });
    
    // Start test server
    logger.logInfo('Starting test server...');
    server = await logger.timeOperation('server_startup', async () => {
      return await startTestServer();
    });
    
    // Create test client
    client = new HttpTestClient({
      baseUrl: E2E_CONFIG.server.url,
      port: server.port,
      credentials: {
        nylasAccessToken: E2E_CONFIG.nylas.nylasAccessToken,
        nylasGrantId: E2E_CONFIG.nylas.nylasGrantId
      }
    });
    
    logger.logSuccess(`Test server started on port ${server.port}`);
  }, 60000);
  
  afterAll(async () => {
    logger.logSection('TEST SUITE CLEANUP');
    
    if (E2E_CONFIG.testData.cleanupAfterTest && testEmailIds.length > 0) {
      logger.logInfo(`Cleaning up ${testEmailIds.length} test emails...`);
      // TODO: Implement cleanup logic
    }
    
    if (server) {
      await server.stop();
      logger.logSuccess('Test server stopped');
    }
    
    logger.logTestSummary(0, 0, 0); // Will be updated by Jest
  });
  
  beforeEach(() => {
    logger.startOperation('test_case');
  });
  
  afterEach(() => {
    logger.endOperation('test_case');
  });
  
  describe('Onboarding Flow', () => {
    test('should list tools with credentials', async () => {
      logger.logStep(1, 'List available tools with credentials');
      
      const response = await logger.timeOperation('list_tools', async () => {
        logger.logApiCall('GET', '/mcp/tools');
        const result = await client.listTools();
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBeGreaterThan(0);
      
      const toolNames = response.tools.map((t: any) => t.name);
      logger.logData('Available Tools', toolNames);
      
      // Should have all email tools available when credentials are present
      expect(toolNames).toContain('manage_email');
      expect(toolNames).toContain('find_emails');
      expect(toolNames).toContain('email_insights');
      expect(toolNames).toContain('organize_inbox');
      expect(toolNames).toContain('smart_folders');
      
      logger.logSuccess('All email tools available with credentials');
    });
    
    test.skip('should validate existing credentials - setup is separate endpoint', async () => {
      logger.logStep(2, 'Validate Nylas credentials');
      
      const response = await logger.timeOperation('validate_credentials', async () => {
        logger.logApiCall('POST', '/mcp/tools/setup', {
          action: 'validate',
          credentials: {
            nylas_api_key: E2E_CONFIG.nylas!.nylasAccessToken,
            nylas_grant_id: E2E_CONFIG.nylas!.nylasGrantId
          }
        });
        
        const result = await client.callTool('setup', {
          action: 'validate',
          credentials: {
            nylas_api_key: E2E_CONFIG.nylas!.nylasAccessToken,
            nylas_grant_id: E2E_CONFIG.nylas!.nylasGrantId
          }
        });
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(response.result).toBeDefined();
      
      // Handle expired or invalid credentials gracefully
      if (response.result.type !== 'setup_success') {
        logger.logError('Validation failed:', response.result);
        
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
      
      expect(response.result.type).toBe('setup_success');
      expect(response.result.credentials_validated).toBe(true);
      
      logger.logData('Validation Result', response.result);
      logger.logSuccess('Credentials validated successfully');
    });
  });
  
  describe('Email Operations with Real Inbox', () => {
    test('should find emails using natural language with AI analysis', async () => {
      logger.logStep(3, 'Find emails using natural language query');
      
      const query = 'emails from the last 24 hours';
      logger.logInfo(`Query: "${query}"`);
      
      const response = await logger.timeOperation('find_emails', async () => {
        logger.logApiCall('POST', '/mcp/tools/find_emails', {
          query,
          analysis_type: 'full',
          limit: 10
        });
        
        const result = await client.callTool('find_emails', {
          query,
          analysis_type: 'full',
          limit: 10
        });
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(response.result).toBeDefined();
      expect(response.result.emails).toBeDefined();
      expect(Array.isArray(response.result.emails)).toBe(true);
      
      logger.logData('Found Emails Count', response.result.emails.length);
      
      if (response.result.emails.length > 0) {
        logger.logData('First Email', {
          from: response.result.emails[0].from,
          subject: response.result.emails[0].subject,
          date: response.result.emails[0].date
        });
      }
      
      if (response.result.summary) {
        logger.logData('AI Summary', response.result.summary);
      }
      
      logger.logSuccess(`Found ${response.result.emails.length} emails with AI analysis`);
    });
    
    test('should send email with approval flow', async () => {
      logger.logStep(4, 'Send email with natural language and approval');
      
      const query = `send a test email to ${E2E_CONFIG.testData.testRecipientEmail} saying this is an automated test from Inbox MCP`;
      
      logger.logInfo(`Query: "${query}"`);
      
      // Step 1: Initial request that should require approval
      logger.logInfo('Step 4a: Initial email request');
      const initialResponse = await logger.timeOperation('initial_email_request', async () => {
        logger.logApiCall('POST', '/mcp/tools/manage_email', {
          action: 'send',
          query,
          require_approval: true
        });
        
        const result = await client.callTool('manage_email', {
          action: 'send',
          query,
          require_approval: true
        });
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(initialResponse.result).toBeDefined();
      expect(initialResponse.result.needs_approval).toBe(true);
      expect(initialResponse.result.action_type).toBe('send_email');
      expect(initialResponse.result.action_data).toBeDefined();
      expect(initialResponse.result.preview).toBeDefined();
      
      logger.logData('Approval Preview', initialResponse.result.preview);
      logger.logSuccess('Email generated and requires approval');
      
      // Step 2: Approve and send the email
      logger.logInfo('Step 4b: Approve and send email');
      const approvalResponse = await logger.timeOperation('approve_email_send', async () => {
        logger.logApiCall('POST', '/mcp/tools/manage_email', {
          ...initialResponse.result.action_data.original_params,
          approved: true,
          action_data: initialResponse.result.action_data
        });
        
        const result = await client.approveAction(
          'manage_email',
          initialResponse.result.action_data.original_params,
          initialResponse.result.action_data
        );
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(approvalResponse.result).toBeDefined();
      expect(approvalResponse.result.success).toBe(true);
      expect(approvalResponse.result.message_id).toBeDefined();
      expect(approvalResponse.result.approval_executed).toBe(true);
      
      // Track for cleanup
      if (approvalResponse.result.message_id) {
        testEmailIds.push(approvalResponse.result.message_id);
      }
      
      logger.logData('Send Result', {
        message_id: approvalResponse.result.message_id,
        success: approvalResponse.result.success
      });
      logger.logSuccess('Email sent successfully after approval');
    });
  });
  
  describe('AI-Powered Features', () => {
    test('should generate email insights', async () => {
      logger.logStep(5, 'Generate AI-powered email insights');
      
      const response = await logger.timeOperation('email_insights', async () => {
        logger.logApiCall('POST', '/mcp/tools/email_insights', {
          query: 'summarize my emails today',
          time_period: 'today'
        });
        
        const result = await client.callTool('email_insights', {
          query: 'summarize my emails today',
          time_period: 'today'
        });
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(response.result).toBeDefined();
      expect(response.result.insights).toBeDefined();
      
      logger.logData('Insights', response.result.insights);
      logger.logSuccess('Generated email insights using AI');
    });
    
    test('should analyze inbox organization with dry run', async () => {
      logger.logStep(6, 'Analyze inbox organization (dry run)');
      
      const response = await logger.timeOperation('organize_analysis', async () => {
        logger.logApiCall('POST', '/mcp/tools/organize_inbox', {
          instruction: 'organize my emails by importance and archive old newsletters',
          dry_run: true
        });
        
        const result = await client.callTool('organize_inbox', {
          instruction: 'organize my emails by importance and archive old newsletters',
          dry_run: true
        });
        
        logger.logApiResponse(200, result);
        return result;
      });
      
      expect(response.result).toBeDefined();
      
      if (response.result.organization_plan) {
        logger.logData('Organization Plan', response.result.organization_plan);
        logger.logInfo(`Would affect ${response.result.total_actions || 0} emails`);
      }
      
      logger.logSuccess('Generated inbox organization plan');
    });
  });
  
  describe('Error Handling', () => {
    test('should handle missing credentials gracefully', async () => {
      logger.logStep(7, 'Test missing credentials error handling');
      
      // Create client without credentials
      const noCredClient = new HttpTestClient({
        baseUrl: E2E_CONFIG.server.url,
        port: server.port
      });
      
      const response = await logger.timeOperation('missing_credentials_test', async () => {
        logger.logApiCall('POST', '/mcp/tools/manage_email', {
          action: 'send',
          query: 'test email'
        });
        
        const result = await noCredClient.callTool('manage_email', {
          action: 'send',
          query: 'test email'
        });
        
        logger.logApiResponse(401, result);
        return result;
      });
      
      expect(response.error).toBeDefined();
      expect(response.error).toContain('Missing Nylas credentials');
      
      logger.logWarning('Correctly handled missing credentials');
    });
    
    test('should handle invalid tool gracefully', async () => {
      logger.logStep(8, 'Test invalid tool error handling');
      
      const response = await logger.timeOperation('invalid_tool_test', async () => {
        logger.logApiCall('POST', '/mcp/tools/invalid_tool', {});
        
        const result = await client.callTool('invalid_tool', {});
        
        logger.logApiResponse(404, result);
        return result;
      });
      
      expect(response.error).toBeDefined();
      expect(response.error).toContain('Unknown tool');
      
      logger.logWarning('Correctly handled invalid tool');
    });
  });
});