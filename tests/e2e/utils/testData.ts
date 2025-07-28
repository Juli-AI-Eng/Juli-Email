import { E2E_CONFIG } from '../config';

export interface TestEmail {
  to: string;
  subject: string;
  body: string;
}

export interface TestScenario {
  name: string;
  description: string;
  tool: string;
  input: any;
  expectedBehavior: string;
  gradingCriteria?: {
    queryUnderstanding: string;
    actionAccuracy: string;
    responseQuality: string;
    errorHandling: string;
  };
}

// Generate unique test email data
export function generateTestEmail(scenario: string): TestEmail {
  const timestamp = Date.now();
  return {
    to: E2E_CONFIG.nylas.testEmail,
    subject: `${E2E_CONFIG.testData.emailPrefix} ${scenario} - ${timestamp}`,
    body: `This is an automated test email for scenario: ${scenario}\n\nTimestamp: ${timestamp}\n\nThis email can be safely deleted.`
  };
}

// Common test scenarios
export const TEST_SCENARIOS: Record<string, TestScenario[]> = {
  manageEmail: [
    {
      name: 'Send simple email',
      description: 'Send a basic email to test address',
      tool: 'manage_email',
      input: {
        action: 'send',
        query: `Send an email to ${E2E_CONFIG.nylas.testEmail} with subject "Test Email" and body "This is a test"`,
        require_approval: false
      },
      expectedBehavior: 'Email should be sent successfully',
      gradingCriteria: {
        queryUnderstanding: 'Correctly identified recipient, subject, and body',
        actionAccuracy: 'Email was actually sent with correct content',
        responseQuality: 'Clear confirmation of sent email',
        errorHandling: 'No errors occurred'
      }
    },
    {
      name: 'Draft complex email',
      description: 'Create a draft with multiple recipients and formatting',
      tool: 'manage_email',
      input: {
        action: 'draft',
        query: `Draft an email to john@example.com and jane@example.com about the quarterly review meeting next Tuesday at 2 PM. Include agenda items: budget review, project updates, and Q4 planning.`
      },
      expectedBehavior: 'Draft should be created with proper formatting',
      gradingCriteria: {
        queryUnderstanding: 'Identified all recipients and meeting details',
        actionAccuracy: 'Draft created with all specified content',
        responseQuality: 'Well-formatted email with clear agenda',
        errorHandling: 'Handled multiple recipients correctly'
      }
    }
  ],
  
  findEmails: [
    {
      name: 'Find recent emails',
      description: 'Search for emails from the last week',
      tool: 'find_emails',
      input: {
        query: 'Show me all emails from the last 7 days',
        limit: 10
      },
      expectedBehavior: 'Should return recent emails with summaries',
      gradingCriteria: {
        queryUnderstanding: 'Correctly interpreted time range',
        actionAccuracy: 'Returned only emails from last 7 days',
        responseQuality: 'Clear summary of found emails',
        errorHandling: 'Handled empty results gracefully'
      }
    },
    {
      name: 'Find important unread',
      description: 'Search for important unread emails',
      tool: 'find_emails',
      input: {
        query: 'Find unread emails that seem important or urgent',
        analysis_type: 'priority'
      },
      expectedBehavior: 'Should identify and prioritize important emails',
      gradingCriteria: {
        queryUnderstanding: 'Understood importance and unread criteria',
        actionAccuracy: 'Filtered to unread and assessed importance',
        responseQuality: 'Clear prioritization with reasoning',
        errorHandling: 'Handled subjective criteria well'
      }
    }
  ],
  
  organizeInbox: [
    {
      name: 'Auto-organize inbox',
      description: 'Automatically organize inbox based on AI analysis',
      tool: 'organize_inbox',
      input: {
        instruction: 'organize my emails by importance and archive old newsletters',
        dry_run: true
      },
      expectedBehavior: 'Should provide organization preview without making changes',
      gradingCriteria: {
        queryUnderstanding: 'Understood auto-organization request',
        actionAccuracy: 'Generated sensible organization rules',
        responseQuality: 'Clear preview of proposed changes',
        errorHandling: 'Respected dry_run parameter'
      }
    }
  ],
  
  emailInsights: [
    {
      name: 'Daily summary',
      description: 'Generate daily email summary',
      tool: 'email_insights',
      input: {
        query: 'summarize my emails today',
        time_period: 'today'
      },
      expectedBehavior: 'Should provide comprehensive daily summary',
      gradingCriteria: {
        queryUnderstanding: 'Generated appropriate daily summary',
        actionAccuracy: 'Included relevant emails from today',
        responseQuality: 'Well-structured and informative summary',
        errorHandling: 'Handled low email volume gracefully'
      }
    }
  ],
  
  smartFolders: [
    {
      name: 'Create project folder',
      description: 'Create smart folder for project emails',
      tool: 'smart_folders',
      input: {
        query: 'Create a folder called Project Alpha for all emails related to Project Alpha including mentions of alpha, project status, or from the project team',
        folder_name: 'Project Alpha',
        dry_run: true
      },
      expectedBehavior: 'Should create smart folder with appropriate rules',
      gradingCriteria: {
        queryUnderstanding: 'Correctly parsed folder requirements',
        actionAccuracy: 'Generated comprehensive matching rules',
        responseQuality: 'Clear explanation of folder rules',
        errorHandling: 'Validated folder name and rules'
      }
    }
  ]
};

// Cleanup test emails
export async function cleanupTestEmails(nylas: any, grantId: string): Promise<void> {
  try {
    // Search for test emails
    const messages = await nylas.messages.list({
      grantId,
      query: `subject:"${E2E_CONFIG.testData.emailPrefix}"`,
      limit: 100
    });

    // Delete test emails
    for (const message of messages.data || []) {
      try {
        await nylas.messages.destroy({
          grantId,
          messageId: message.id
        });
      } catch (error) {
        console.warn(`Failed to delete test email ${message.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}