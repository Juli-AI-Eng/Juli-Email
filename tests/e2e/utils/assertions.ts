/**
 * Assertion helpers for email verification in E2E tests
 */

import { Email } from '../../../src/types/index';
import { logger } from './testLogger';

/**
 * Email-specific assertions
 */
export class EmailAssertions {
  /**
   * Assert email has expected structure
   */
  static assertValidEmail(email: any, description?: string) {
    if (description) {
      logger.logInfo(`Asserting valid email: ${description}`);
    }
    
    expect(email).toBeDefined();
    expect(email.id).toBeDefined();
    expect(typeof email.id).toBe('string');
    
    // Check required fields
    expect(email.from).toBeDefined();
    expect(Array.isArray(email.from)).toBe(true);
    expect(email.from.length).toBeGreaterThan(0);
    
    if (email.from[0]) {
      expect(email.from[0].email).toBeDefined();
      expect(email.from[0].email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
    
    expect(email.subject).toBeDefined();
    expect(typeof email.subject).toBe('string');
    
    // Check optional but common fields
    if (email.to) {
      expect(Array.isArray(email.to)).toBe(true);
    }
    
    if (email.date) {
      expect(typeof email.date).toBe('number');
      expect(email.date).toBeGreaterThan(0);
    }
    
    logger.logSuccess('Email structure is valid');
  }
  
  /**
   * Assert email contains test prefix
   */
  static assertIsTestEmail(email: any, testPrefix: string) {
    expect(email.subject).toBeDefined();
    expect(email.subject).toContain(testPrefix);
    logger.logSuccess(`Email is test email with prefix: ${testPrefix}`);
  }
  
  /**
   * Assert email was sent recently
   */
  static assertRecentEmail(email: any, maxAgeMinutes: number = 5) {
    expect(email.date).toBeDefined();
    
    const emailDate = new Date(email.date * 1000); // Convert from Unix timestamp
    const now = new Date();
    const ageMinutes = (now.getTime() - emailDate.getTime()) / (1000 * 60);
    
    expect(ageMinutes).toBeLessThan(maxAgeMinutes);
    logger.logSuccess(`Email is recent (${ageMinutes.toFixed(1)} minutes old)`);
  }
  
  /**
   * Assert email list response
   */
  static assertEmailListResponse(response: any, minCount?: number) {
    expect(response).toBeDefined();
    expect(response.emails).toBeDefined();
    expect(Array.isArray(response.emails)).toBe(true);
    
    if (minCount !== undefined) {
      expect(response.emails.length).toBeGreaterThanOrEqual(minCount);
    }
    
    logger.logSuccess(`Email list contains ${response.emails.length} emails`);
    
    // Validate each email in the list
    response.emails.forEach((email: any, index: number) => {
      try {
        this.assertValidEmail(email);
      } catch (error) {
        logger.logError(`Invalid email at index ${index}`, error);
        throw error;
      }
    });
  }
}

/**
 * Approval flow assertions
 */
export class ApprovalAssertions {
  /**
   * Assert valid approval request
   */
  static assertApprovalRequired(response: any) {
    expect(response).toBeDefined();
    expect(response.needs_approval).toBe(true);
    expect(response.action_type).toBeDefined();
    expect(response.action_data).toBeDefined();
    expect(response.preview).toBeDefined();
    
    // Check preview structure
    expect(response.preview.summary).toBeDefined();
    expect(typeof response.preview.summary).toBe('string');
    expect(response.preview.details).toBeDefined();
    
    logger.logSuccess('Valid approval request structure');
  }
  
  /**
   * Assert email approval preview
   */
  static assertEmailApprovalPreview(response: any, expectedRecipient?: string) {
    this.assertApprovalRequired(response);
    
    expect(response.action_type).toBe('send_email');
    expect(response.action_data.email_content).toBeDefined();
    expect(response.action_data.original_params).toBeDefined();
    
    const preview = response.preview;
    expect(preview.details.to).toBeDefined();
    expect(Array.isArray(preview.details.to)).toBe(true);
    expect(preview.details.subject).toBeDefined();
    expect(preview.details.body).toBeDefined();
    
    if (expectedRecipient) {
      expect(preview.details.to).toContain(expectedRecipient);
    }
    
    logger.logSuccess('Valid email approval preview');
  }
}

/**
 * AI response assertions
 */
export class AIAssertions {
  /**
   * Assert AI-generated content
   */
  static assertAIGeneratedContent(content: any, field: string) {
    expect(content).toBeDefined();
    expect(content[field]).toBeDefined();
    expect(typeof content[field]).toBe('string');
    expect(content[field].length).toBeGreaterThan(10); // Meaningful content
    
    logger.logSuccess(`AI generated valid ${field}`);
  }
  
  /**
   * Assert email insights response
   */
  static assertEmailInsights(response: any) {
    expect(response).toBeDefined();
    expect(response.insights).toBeDefined();
    
    // Should have some form of structured insights
    const insights = response.insights;
    const insightKeys = Object.keys(insights);
    expect(insightKeys.length).toBeGreaterThan(0);
    
    logger.logSuccess(`Generated ${insightKeys.length} insight categories`);
  }
  
  /**
   * Assert organization plan
   */
  static assertOrganizationPlan(response: any) {
    expect(response).toBeDefined();
    
    if (response.plan) {
      expect(response.plan).toBeDefined();
      
      // Should have some organization actions
      if (response.plan.actions) {
        expect(Array.isArray(response.plan.actions)).toBe(true);
        logger.logSuccess(`Organization plan has ${response.plan.actions.length} actions`);
      }
      
      // Should indicate affected emails
      if (response.plan.total_affected !== undefined) {
        expect(typeof response.plan.total_affected).toBe('number');
        expect(response.plan.total_affected).toBeGreaterThanOrEqual(0);
      }
    }
  }
}

/**
 * Error assertions
 */
export class ErrorAssertions {
  /**
   * Assert missing credentials error
   */
  static assertMissingCredentialsError(response: any) {
    expect(response.error).toBeDefined();
    expect(response.error.toLowerCase()).toContain('missing');
    expect(response.error.toLowerCase()).toContain('credentials');
    
    logger.logSuccess('Correctly reported missing credentials');
  }
  
  /**
   * Assert validation error
   */
  static assertValidationError(response: any, expectedField?: string) {
    expect(response.error).toBeDefined();
    expect(response.error.toLowerCase()).toContain('validation');
    
    if (expectedField) {
      expect(response.error.toLowerCase()).toContain(expectedField.toLowerCase());
    }
    
    logger.logSuccess('Correctly reported validation error');
  }
}

/**
 * Test data assertions
 */
export class TestDataAssertions {
  /**
   * Assert test email was created with correct prefix
   */
  static assertTestEmailCreated(email: any, testPrefix: string, testRecipient: string) {
    EmailAssertions.assertValidEmail(email);
    EmailAssertions.assertIsTestEmail(email, testPrefix);
    
    expect(email.to).toBeDefined();
    expect(email.to.some((r: any) => r.email === testRecipient)).toBe(true);
    
    logger.logSuccess('Test email created correctly');
  }
  
  /**
   * Assert clean test state
   */
  static async assertNoTestEmails(client: any, testPrefix: string) {
    const response = await client.callTool('find_emails', {
      query: `subject:"${testPrefix}"`,
      limit: 10
    });
    
    expect(response.result).toBeDefined();
    expect(response.result.emails).toBeDefined();
    expect(response.result.emails.length).toBe(0);
    
    logger.logSuccess('No test emails found - clean state');
  }
}

// Export all assertion classes
export {
  EmailAssertions as Email,
  ApprovalAssertions as Approval,
  AIAssertions as AI,
  ErrorAssertions as Error,
  TestDataAssertions as TestData
};