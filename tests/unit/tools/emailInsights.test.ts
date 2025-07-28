import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { EmailInsightsTool } from '../../../src/tools/emailInsights';
import { EmailAI } from '../../../src/ai/emailAI';
import Nylas from 'nylas';
import { EmailInsightsParams, Email, EmailAnalysis } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/ai/emailAI');
jest.mock('nylas');

describe('EmailInsightsTool', () => {
  let tool: EmailInsightsTool;
  let mockEmailAI: jest.Mocked<EmailAI>;
  let mockNylas: jest.Mocked<Nylas>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockEmailAI = new EmailAI() as jest.Mocked<EmailAI>;
    mockNylas = new Nylas({ apiKey: 'test' }) as jest.Mocked<Nylas>;
    
    // Setup default mocks for EmailAI methods
    (mockEmailAI as any).understandInsightsQuery = jest.fn<any>();
    (mockEmailAI as any).generateDailyInsights = jest.fn<any>();
    (mockEmailAI as any).generateWeeklyInsights = jest.fn<any>();
    (mockEmailAI as any).generateImportantItemsInsights = jest.fn<any>();
    (mockEmailAI as any).generateResponseNeededInsights = jest.fn<any>();
    (mockEmailAI as any).generateAnalyticsInsights = jest.fn<any>();
    (mockEmailAI as any).generateRelationshipInsights = jest.fn<any>();
    (mockEmailAI as any).categorizeEmails = jest.fn<any>();
    
    tool = new EmailInsightsTool(mockNylas, 'grant123', mockEmailAI);
  });

  describe('daily summary', () => {
    it('should generate daily summary insights', async () => {
      const params: EmailInsightsParams = {
        query: 'summarize my emails today'
      };

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Mock emails from today
      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Urgent: Project deadline',
          from: [{ email: 'boss@company.com', name: 'Boss' }],
          date: Date.now() / 1000,
          unread: true
        },
        {
          id: 'msg2',
          subject: 'Meeting reminder',
          from: [{ email: 'calendar@company.com' }],
          date: Date.now() / 1000,
          unread: false
        },
        {
          id: 'msg3',
          subject: 'Newsletter: Daily Tech',
          from: [{ email: 'news@techsite.com' }],
          date: Date.now() / 1000,
          unread: true
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI analysis
      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'daily_summary'
      });

      mockEmailAI.analyzeEmailImportance.mockResolvedValue([
        {
          email_id: 'msg1',
          importance_score: 0.95,
          category: 'urgent_alert',
          reason: 'Urgent project deadline from boss',
          action_required: true
        },
        {
          email_id: 'msg2',
          importance_score: 0.7,
          category: 'notification',
          reason: 'Meeting reminder',
          action_required: false
        },
        {
          email_id: 'msg3',
          importance_score: 0.2,
          category: 'newsletter',
          reason: 'Daily newsletter',
          action_required: false
        }
      ]);

      // Mock AI daily insights generation
      (mockEmailAI as any).generateDailyInsights = jest.fn<any>().mockResolvedValue({
        executive_summary: '3 emails today with 2 unread. 1 urgent item requires immediate attention.',
        key_highlights: ['Urgent project deadline from boss', 'Meeting reminder for today'],
        action_priorities: ['Review and respond to boss about project deadline'],
        patterns: ['Higher than usual urgent emails'],
        recommendations: ['Address urgent deadline first', 'Clear unread emails']
      });

      const result = await tool.execute(params);

      expect(result.summary).toContain('3 emails today');
      expect(result.summary).toContain('2 unread');
      expect(result.insights.total_emails).toBe(3);
      expect(result.insights.unread_count).toBe(2);
      expect(result.insights.important_emails).toHaveLength(1);
      expect(result.insights.categories).toEqual({
        urgent_alert: 1,
        notification: 1,
        newsletter: 1
      });
    });
  });

  describe('important items', () => {
    it('should identify important emails that need attention', async () => {
      const params: EmailInsightsParams = {
        query: 'what important emails did I get?'
      };

      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Contract needs signature',
          from: [{ email: 'legal@company.com' }],
          snippet: 'Please sign the attached contract by Friday...'
        },
        {
          id: 'msg2',
          subject: 'Budget approval required',
          from: [{ email: 'finance@company.com' }],
          snippet: 'Q1 budget needs your approval...'
        },
        {
          id: 'msg3',
          subject: 'FYI: Team update',
          from: [{ email: 'team@company.com' }],
          snippet: 'Just wanted to share...'
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      mockEmailAI.analyzeEmailImportance.mockResolvedValue([
        {
          email_id: 'msg1',
          importance_score: 0.95,
          category: 'urgent_alert',
          reason: 'Contract requires signature by deadline',
          action_required: true
        },
        {
          email_id: 'msg2',
          importance_score: 0.9,
          category: 'urgent_alert',
          reason: 'Budget approval needed',
          action_required: true
        },
        {
          email_id: 'msg3',
          importance_score: 0.3,
          category: 'notification',
          reason: 'Team update for awareness',
          action_required: false
        }
      ]);

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'important_items'
      });

      // Mock AI important items generation
      (mockEmailAI as any).generateImportantItemsInsights = jest.fn<any>().mockResolvedValue({
        executive_summary: 'Found 2 important emails that require attention. 2 action items identified.',
        priority_items: [
          {
            email_id: 'msg1',
            subject: 'Contract needs signature',
            from: 'legal@company.com',
            importance_reason: 'Contract requires signature by deadline',
            action_required: 'Sign the attached contract'
          },
          {
            email_id: 'msg2',
            subject: 'Budget approval required',
            from: 'finance@company.com',
            importance_reason: 'Budget approval needed',
            action_required: 'Approve Q1 budget'
          }
        ],
        action_plan: ['Sign contract by Friday', 'Approve Q1 budget'],
        key_deadlines: ['Friday: Contract signature']
      });

      // Mock action items
      mockEmailAI.extractActionItems
        .mockResolvedValueOnce([
          {
            task: 'Sign contract',
            deadline: 'Friday',
            priority: 'high'
          }
        ])
        .mockResolvedValueOnce([
          {
            task: 'Approve Q1 budget',
            deadline: undefined,
            priority: 'high'
          }
        ]);

      const result = await tool.execute(params);

      expect(result.summary).toContain('Found 2 important emails that require attention');
      expect(result.insights.priority_items).toHaveLength(2);
      expect(result.insights.action_items).toHaveLength(2);
      expect(result.insights.action_items?.[0].task).toBe('Sign contract');
      expect(result.insights.action_plan).toContain('Sign contract by Friday');
      expect(result.insights.key_deadlines).toContain('Friday: Contract signature');
    });
  });

  describe('response needed', () => {
    it('should find emails that need responses', async () => {
      const params: EmailInsightsParams = {
        query: 'what emails need my response?'
      };

      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Question about project',
          from: [{ email: 'colleague@company.com' }],
          snippet: 'Can you clarify the requirements?',
          thread_id: 'thread1'
        },
        {
          id: 'msg2',
          subject: 'Re: Meeting tomorrow',
          from: [{ email: 'boss@company.com' }],
          snippet: 'Are you available at 3pm?',
          thread_id: 'thread2'
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock thread checking to see if replied
      mockNylas.threads = {
        find: jest.fn<any>()
          .mockResolvedValueOnce({ 
            data: { 
              id: 'thread1',
              messageIds: ['msg1'] // No reply
            } 
          })
          .mockResolvedValueOnce({ 
            data: { 
              id: 'thread2',
              messageIds: ['msg2'] // No reply
            } 
          })
      } as any;

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'response_needed'
      });

      // Mock AI response insights generation
      (mockEmailAI as any).generateResponseNeededInsights = jest.fn<any>().mockResolvedValue({
        executive_summary: '2 emails need responses. 1 is high priority.',
        response_priorities: [
          {
            email_id: 'msg2',
            subject: 'Re: Meeting tomorrow',
            from: 'boss@company.com',
            urgency: 'high',
            suggested_response: 'Confirm availability for 3pm meeting',
            context: 'Boss asking about meeting availability'
          },
          {
            email_id: 'msg1',
            subject: 'Question about project',
            from: 'colleague@company.com',
            urgency: 'medium',
            suggested_response: 'Provide project requirements clarification',
            context: 'Colleague needs clarification on requirements'
          }
        ],
        response_strategy: ['Start with high-priority boss email', 'Then address colleague question'],
        time_estimate: '15-20 minutes'
      });

      const result = await tool.execute(params);

      expect(result.summary).toContain('2 emails need responses');
      expect(result.insights.response_priorities).toHaveLength(2);
      expect(result.insights.response_priorities[0].urgency).toBe('high');
      expect(result.insights.time_estimate).toBe('15-20 minutes');
    });
  });

  describe('analytics', () => {
    it('should provide email analytics for time period', async () => {
      const params: EmailInsightsParams = {
        query: 'show me email analytics for this week'
      };

      // Mock emails from past week
      const mockEmails = Array(20).fill(null).map((_, i) => ({
        id: `msg${i}`,
        subject: `Email ${i}`,
        from: [{ email: i < 10 ? 'sender1@test.com' : 'sender2@test.com' }],
        date: Math.floor((Date.now() - i * 24 * 60 * 60 * 1000) / 1000),
        unread: i < 5
      }));

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI categorization
      (mockEmailAI as any).categorizeEmails = jest.fn<any>().mockResolvedValue(
        new Map([
          ['work', ['msg0', 'msg1', 'msg2', 'msg3', 'msg4']],
          ['personal', ['msg5', 'msg6', 'msg7']],
          ['newsletters', ['msg8', 'msg9', 'msg10']]
        ])
      );

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'analytics',
        time_period: 'week'
      });

      // Mock AI analytics generation
      (mockEmailAI as any).generateAnalyticsInsights = jest.fn<any>().mockResolvedValue({
        executive_summary: 'Email activity is moderate with 20 emails this week (2.9/day). Most communication is work-related.',
        volume_analysis: {
          trend: 'Normal activity levels',
          pattern: 'Higher volume on weekdays',
          anomalies: ['Spike on Tuesday with 5 emails']
        },
        sender_insights: {
          top_relationships: ['sender1@test.com', 'sender2@test.com'],
          communication_balance: 'Balanced between sending and receiving',
          new_contacts: ['newcontact@test.com']
        },
        productivity_metrics: {
          response_rate: '75% of emails requiring response were answered',
          peak_hours: ['9-10 AM', '2-3 PM'],
          email_habits: ['Quick responder', 'Organized inbox']
        },
        recommendations: ['Consider batching email responses', 'Set up filters for newsletters']
      });

      const result = await tool.execute(params);

      expect(result.summary).toContain('Email activity is moderate');
      expect(result.insights.volume_analysis).toBeDefined();
      expect(result.insights.sender_insights.top_relationships).toContain('sender1@test.com');
      expect(result.insights.productivity_metrics.response_rate).toContain('75%');
      expect(result.insights.recommendations).toHaveLength(2);
    });
  });

  describe('relationships', () => {
    it('should analyze email relationships and communication patterns', async () => {
      const params: EmailInsightsParams = {
        query: 'who am I communicating with most?'
      };

      // Mock emails with various senders
      const mockEmails = [
        { id: '1', from: [{ email: 'boss@company.com' }], to: [{ email: 'me@company.com' }] },
        { id: '2', from: [{ email: 'me@company.com' }], to: [{ email: 'boss@company.com' }] },
        { id: '3', from: [{ email: 'boss@company.com' }], to: [{ email: 'me@company.com' }] },
        { id: '4', from: [{ email: 'client@external.com' }], to: [{ email: 'me@company.com' }] },
        { id: '5', from: [{ email: 'newsletter@service.com' }], to: [{ email: 'me@company.com' }] }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      mockEmailAI.analyzeEmailImportance.mockResolvedValue(
        mockEmails.map((email, i) => ({
          email_id: email.id,
          importance_score: i < 3 ? 0.8 : 0.3,
          category: i < 3 ? 'client_email' : 'newsletter' as any,
          reason: 'test',
          action_required: false
        }))
      );

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'relationships'
      });

      // Mock AI relationship insights generation
      (mockEmailAI as any).generateRelationshipInsights = jest.fn<any>().mockResolvedValue({
        executive_summary: 'Your communication network shows healthy patterns with 3 key relationships.',
        key_relationships: [
          {
            contact: 'boss@company.com',
            relationship_type: 'manager',
            communication_style: 'Formal, frequent exchanges',
            insights: ['High response rate', 'Regular check-ins']
          },
          {
            contact: 'client@external.com',
            relationship_type: 'client',
            communication_style: 'Professional, project-focused',
            insights: ['Important for business', 'Needs timely responses']
          }
        ],
        communication_patterns: {
          balance_analysis: 'Well-balanced communication with most contacts',
          response_patterns: ['Quick responses to important contacts', 'Some delayed responses to newsletters'],
          collaboration_insights: ['Strong collaboration with boss', 'Growing client relationship']
        },
        network_insights: {
          growing_relationships: ['client@external.com'],
          neglected_contacts: ['colleague@company.com'],
          communication_health: 'Good - maintaining key relationships well'
        },
        recommendations: ['Schedule regular check-ins with neglected contacts', 'Maintain current response patterns']
      });

      const result = await tool.execute(params);

      expect(result.summary).toContain('Your communication network shows healthy patterns');
      expect(result.insights.key_relationships).toHaveLength(2);
      expect(result.insights.key_relationships[0].contact).toBe('boss@company.com');
      expect(result.insights.network_insights.communication_health).toContain('Good');
      expect(result.insights.recommendations).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should handle Nylas API errors', async () => {
      const params: EmailInsightsParams = {
        query: 'summarize my emails today'
      };

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'daily_summary'
      });

      mockNylas.messages = {
        list: jest.fn<any>().mockRejectedValue(new Error('API error'))
      } as any;

      await expect(tool.execute(params)).rejects.toThrow();
    });

    it('should handle AI analysis errors gracefully', async () => {
      const params: EmailInsightsParams = {
        query: 'what important emails did I get?'
      };

      // Mock AI understanding of query
      (mockEmailAI as any).understandInsightsQuery = jest.fn<any>().mockResolvedValue({
        insight_type: 'important_items'
      });

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: [{ id: '1', subject: 'Test' }] })
      } as any;

      mockEmailAI.analyzeEmailImportance.mockRejectedValue(new Error('AI unavailable'));

      const result = await tool.execute(params);

      // Should still return basic insights without AI analysis
      expect(result.insights.total_emails).toBe(1);
      expect(result.insights.important_emails).toEqual([]);
    });
  });
});