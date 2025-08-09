import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { EmailAI } from '../../../src/ai/emailAI';
import { EmailIntent, EmailAnalysis, GeneratedEmail } from '../../../src/types';
import OpenAI from 'openai';

// Mock OpenAI
jest.mock('openai');

describe('EmailAI', () => {
  let emailAI: EmailAI;
  let mockCreate: jest.Mock<any>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    // Save original env var
    originalEnv = process.env.OPENAI_API_KEY;
    // Set test API key
    process.env.OPENAI_API_KEY = 'test-api-key';

    mockCreate = jest.fn();

    // Mock the OpenAI constructor to return our mock
    (OpenAI as any).mockImplementation(() => ({
      responses: {
        create: mockCreate
      }
    }));

    emailAI = new EmailAI();
  });

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  describe('understandQuery', () => {
    it('should parse a simple send email request', async () => {
      const query = 'send an email to john@example.com about the meeting tomorrow';

      // Mock OpenAI response with function calling
      const mockResponse = {
        output: [
          {
            type: 'function_call',
            name: 'extract_email_intent',
            arguments: JSON.stringify({
              intent: 'send',
              recipients: ['john@example.com'],
              subject: 'Meeting Tomorrow',
              key_points: ['meeting scheduled for tomorrow'],
              urgency: 'normal',
              tone: 'professional'
            })
          }
        ]
      } as any;

      mockCreate.mockResolvedValue(mockResponse);

      const result = await emailAI.understandQuery(query);

      expect(result).toEqual({
        intent: 'send',
        recipients: ['john@example.com'],
        subject: 'Meeting Tomorrow',
        key_points: ['meeting scheduled for tomorrow'],
        urgency: 'normal',
        tone: 'professional'
      });
    });

    it('should parse a reply request with context', async () => {
      const query = 'reply to Sarah thanking her for the proposal';
      const context = { senderEmail: 'sarah@company.com' };

      const mockResponse = {
        output: [
          {
            type: 'function_call',
            name: 'extract_email_intent',
            arguments: JSON.stringify({
              intent: 'reply',
              recipients: [],
              subject: 'Re: Proposal',
              key_points: ['thank you for the proposal'],
              urgency: 'normal',
              tone: 'grateful'
            })
          }
        ]
      } as any;

      mockCreate.mockResolvedValue(mockResponse);

      const result = await emailAI.understandQuery(query, context);

      expect(result.intent).toBe('reply');
      expect(result.recipients).toContain('sarah@company.com');
      expect(result.key_points).toContain('thank you for the proposal');
    });
  });

  describe('generateEmailContent', () => {
    it('should generate email content from intent', async () => {
      const intent: EmailIntent = {
        intent: 'send',
        recipients: ['client@example.com'],
        subject: 'Project Update',
        key_points: ['project on track', 'delivery next week'],
        urgency: 'normal',
        tone: 'professional'
      };

      const mockResponse = {
        output: [
          {
            type: 'function_call',
            name: 'generate_email',
            arguments: JSON.stringify({
              to: ['client@example.com'],
              cc: null,
              bcc: null,
              subject: 'Project Update - On Track for Next Week',
              body: 'Dear Client,\n\nI wanted to update you on our project progress...',
              tone_confirmation: 'professional'
            })
          }
        ]
      } as any;

      mockCreate.mockResolvedValue(mockResponse);

      const result = await emailAI.generateEmailContent(intent);

      expect(result.to).toEqual(['client@example.com']);
      expect(result.subject).toBe('Project Update - On Track for Next Week');
      expect(result.body).toContain('project progress');
    });
  });

  describe('analyzeEmailImportance', () => {
    it('should analyze importance of multiple emails', async () => {
      const emails = [
        {
          id: '1',
          subject: 'URGENT: Server down',
          from: [{ email: 'alerts@company.com' }],
          snippet: 'Production server is experiencing downtime'
        },
        {
          id: '2',
          subject: 'Newsletter',
          from: [{ email: 'news@example.com' }],
          snippet: 'Check out our latest blog posts'
        }
      ];

      const mockResponse = {
        output: [
          {
            type: 'function_call',
            name: 'analyze_emails',
            arguments: JSON.stringify({
              analyses: [
                {
                  email_id: '1',
                  importance_score: 0.95,
                  category: 'urgent_alert',
                  reason: 'Production server issue requiring immediate attention',
                  action_required: true,
                  suggested_folder: null
                },
                {
                  email_id: '2',
                  importance_score: 0.2,
                  category: 'newsletter',
                  reason: 'Promotional content, no action required',
                  action_required: false,
                  suggested_folder: null
                }
              ]
            })
          }
        ]
      } as any;

      mockCreate.mockResolvedValue(mockResponse);

      const result = await emailAI.analyzeEmailImportance(emails);

      expect(result).toHaveLength(2);
      expect(result[0].importance_score).toBeGreaterThan(0.9);
      expect(result[1].importance_score).toBeLessThan(0.3);
    });
  });

  describe('extractActionItems', () => {
    it('should extract action items from an email', async () => {
      const email = {
        id: '123',
        subject: 'Project Tasks',
        body: 'Please review the design by Friday and send feedback. Also schedule a meeting for next week.',
        from: [{ email: 'manager@company.com' }]
      };

      const mockResponse = {
        output: [
          {
            type: 'function_call',
            name: 'extract_action_items',
            arguments: JSON.stringify({
              action_items: [
                {
                  task: 'Review design',
                  deadline: 'Friday',
                  priority: 'high'
                },
                {
                  task: 'Send feedback on design',
                  deadline: 'Friday',
                  priority: 'high'
                },
                {
                  task: 'Schedule meeting',
                  deadline: 'Next week',
                  priority: 'medium'
                }
              ]
            })
          }
        ]
      } as any;

      mockCreate.mockResolvedValue(mockResponse);

      const result = await emailAI.extractActionItems(email);

      expect(result).toHaveLength(3);
      expect(result[0].task).toBe('Review design');
      expect(result[0].deadline).toBe('Friday');
    });
  });
});