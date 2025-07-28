import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { FindEmailsTool } from '../../../src/tools/findEmails';
import { EmailAI } from '../../../src/ai/emailAI';
import Nylas from 'nylas';
import { FindEmailsParams, Email, EmailAnalysis } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/ai/emailAI');
jest.mock('nylas');

describe('FindEmailsTool', () => {
  let tool: FindEmailsTool;
  let mockEmailAI: jest.Mocked<EmailAI>;
  let mockNylas: jest.Mocked<Nylas>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockEmailAI = new EmailAI() as jest.Mocked<EmailAI>;
    mockNylas = new Nylas({ apiKey: 'test' }) as jest.Mocked<Nylas>;
    
    // Default mock for AI understanding
    mockEmailAI.understandQuery.mockResolvedValue({
      intent: 'find',
      recipients: [],
      subject: undefined,
      key_points: [],
      urgency: 'normal',
      tone: 'professional'
    });

    // Default mock for search query understanding
    mockEmailAI.understandSearchQuery.mockResolvedValue({
      intent: 'find',
      timeframe: undefined,
      senders: [],
      keywords: [],
      filters: {}
    });
    
    tool = new FindEmailsTool(mockNylas, 'grant123', mockEmailAI);
  });

  describe('natural language search', () => {
    it('should find unread emails from manager', async () => {
      const params: FindEmailsParams = {
        query: 'unread emails from my manager',
        analysis_type: 'summary',
        limit: 20
      };

      // Mock search understanding
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: undefined,
        senders: ['manager@company.com'],
        keywords: ['manager', 'unread'],
        filters: {
          unread: true
        }
      });

      // Mock AI summary generation
      mockEmailAI.generateAggregatedSummary.mockResolvedValue(
        'Found 2 unread emails from your manager about Q4 goals and budget planning.'
      );

      // Mock Nylas search
      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Q4 Goals Review',
          from: [{ email: 'manager@company.com', name: 'John Manager' }],
          snippet: 'Please review the attached Q4 goals...',
          unread: true,
          date: Date.now() / 1000
        },
        {
          id: 'msg2',
          subject: '1:1 Meeting Notes',
          from: [{ email: 'manager@company.com', name: 'John Manager' }],
          snippet: 'Here are the notes from our 1:1...',
          unread: true,
          date: (Date.now() - 86400000) / 1000
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI analysis
      mockEmailAI.analyzeEmailImportance.mockResolvedValue([
        {
          email_id: 'msg1',
          importance_score: 0.9,
          category: 'urgent_alert',
          reason: 'Q4 goals review from manager',
          action_required: true,
          suggested_folder: 'Important'
        },
        {
          email_id: 'msg2',
          importance_score: 0.7,
          category: 'client_email',
          reason: '1:1 meeting notes to review',
          action_required: true,
          suggested_folder: 'Action Required'
        }
      ]);

      const result = await tool.execute(params);

      // For 'summary' analysis_type, emails array is not returned, only summary
      expect(result.emails).toBeUndefined();
      expect(result.total_count).toBe(2);
      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe('string');
      expect(mockNylas.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'grant123',
          queryParams: expect.objectContaining({
            unread: true,
            limit: 20
          })
        })
      );
    });

    it('should find invoices from last month', async () => {
      const params: FindEmailsParams = {
        query: 'invoices from last month',
        analysis_type: 'detailed',
        limit: 50
      };

      // Mock date calculations
      const now = new Date();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Mock search understanding for invoices with date filter
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: {
          start: lastMonthStart,
          end: lastMonthEnd
        },
        senders: [],
        keywords: ['invoice', 'billing', 'payment'],
        filters: {}
      });

      const mockInvoices = [
        {
          id: 'inv1',
          subject: 'Invoice #12345',
          from: [{ email: 'billing@vendor.com' }],
          snippet: 'Invoice for services rendered...',
          date: (lastMonthStart.getTime() + 86400000) / 1000
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockInvoices })
      } as any;

      mockEmailAI.analyzeEmailImportance.mockResolvedValue([
        {
          email_id: 'inv1',
          importance_score: 0.6,
          category: 'other',
          reason: 'Invoice for tracking',
          action_required: false,
          suggested_folder: 'Invoices'
        }
      ]);

      const result = await tool.execute(params);

      expect(result.emails).toHaveLength(1);
      expect(result.analysis).toBeDefined();
      expect(result.analysis?.[0].importance_score).toBe(0.6);
      expect(mockNylas.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          queryParams: expect.objectContaining({
            searchQueryNative: expect.stringContaining('invoice'),
            receivedAfter: expect.any(Number),
            receivedBefore: expect.any(Number)
          })
        })
      );
    });

    it('should find important emails user hasn\'t responded to', async () => {
      const params: FindEmailsParams = {
        query: 'important emails I haven\'t responded to',
        analysis_type: 'action_items'
      };

      // Mock search understanding for important unreplied emails
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: undefined,
        senders: [],
        keywords: ['important', 'response', 'reply'],
        filters: {
          unread: false // Looking for read but unresponded emails
        }
      });

      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Contract Review Needed',
          from: [{ email: 'legal@company.com' }],
          snippet: 'Please review the attached contract by Friday...',
          thread_id: 'thread1'
        },
        {
          id: 'msg2',
          subject: 'Budget Approval Required',
          from: [{ email: 'finance@company.com' }],
          snippet: 'Q1 budget needs your approval...',
          thread_id: 'thread2'
        }
      ];

      // Mock finding emails
      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock thread checking (to see if replied)
      mockNylas.threads = {
        find: jest.fn<any>()
          .mockResolvedValueOnce({ 
            data: { 
              id: 'thread1',
              messageIds: ['msg1'] // Only original message, no reply
            } 
          })
          .mockResolvedValueOnce({ 
            data: { 
              id: 'thread2',
              messageIds: ['msg2'] // Only original message, no reply
            } 
          })
      } as any;

      // Mock importance analysis
      mockEmailAI.analyzeEmailImportance.mockResolvedValue([
        {
          email_id: 'msg1',
          importance_score: 0.95,
          category: 'urgent_alert',
          reason: 'Contract review with deadline',
          action_required: true
        },
        {
          email_id: 'msg2',
          importance_score: 0.9,
          category: 'urgent_alert',
          reason: 'Budget approval needed',
          action_required: true
        }
      ]);

      // Mock action item extraction
      mockEmailAI.extractActionItems
        .mockResolvedValueOnce([
          {
            task: 'Review contract',
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

      expect(result.emails).toHaveLength(2);
      expect(result.action_items).toHaveLength(2);
      expect(result.action_items?.[0].task).toBe('Review contract');
      expect(result.action_items?.[1].task).toBe('Approve Q1 budget');
    });
  });

  describe('analysis types', () => {
    it('should provide summary analysis', async () => {
      const params: FindEmailsParams = {
        query: 'emails from today',
        analysis_type: 'summary'
      };

      // Mock search understanding for today's emails
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: {
          start: new Date(new Date().setHours(0, 0, 0, 0)),
          end: new Date(new Date().setHours(23, 59, 59, 999))
        },
        senders: [],
        keywords: ['today'],
        filters: {}
      });

      const mockEmails = [
        { id: '1', subject: 'Meeting invite', from: [{ email: 'a@test.com' }] },
        { id: '2', subject: 'Project update', from: [{ email: 'b@test.com' }] },
        { id: '3', subject: 'Lunch?', from: [{ email: 'c@test.com' }] }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI summary generation (summary type doesn't use analyzeEmailImportance)
      mockEmailAI.generateAggregatedSummary.mockResolvedValue(
        'Found 3 emails from today: 1 meeting invite, 1 project update, and 1 personal message. 1 requires action.'
      );

      const result = await tool.execute(params);

      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('Found 3 emails');
      expect(result.summary).toContain('1 requires action');
      expect(result.analysis).toBeUndefined(); // Summary mode doesn't include full analysis
    });

    it('should provide priority analysis', async () => {
      const params: FindEmailsParams = {
        query: 'all emails',
        analysis_type: 'priority',
        limit: 10
      };

      const mockEmails = Array(5).fill(null).map((_, i) => ({
        id: `msg${i}`,
        subject: `Email ${i}`,
        from: [{ email: `sender${i}@test.com` }]
      }));

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      const mockAnalysis: EmailAnalysis[] = mockEmails.map((e, i) => ({
        email_id: e.id,
        importance_score: (5 - i) * 0.2, // Descending importance
        category: i === 0 ? 'urgent_alert' : 'other' as any,
        reason: `Reason ${i}`,
        action_required: i < 2
      }));

      mockEmailAI.analyzeEmailImportance.mockResolvedValue(mockAnalysis);

      const result = await tool.execute(params);

      expect(result.emails).toHaveLength(5);
      expect(result.analysis).toHaveLength(5);
      // Should be sorted by importance
      expect(result.analysis?.[0].importance_score).toBe(1.0);
      expect(result.analysis?.[4].importance_score).toBe(0.2);
    });
  });

  describe('error handling', () => {
    it('should handle Nylas API errors', async () => {
      const params: FindEmailsParams = {
        query: 'test query'
      };

      mockNylas.messages = {
        list: jest.fn<any>().mockRejectedValue(new Error('API rate limit exceeded'))
      } as any;

      await expect(tool.execute(params)).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle AI analysis errors gracefully', async () => {
      const params: FindEmailsParams = {
        query: 'test emails',
        analysis_type: 'detailed'
      };

      // Mock search understanding for test query
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: undefined,
        senders: [],
        keywords: ['test'],
        filters: {}
      });

      const mockEmails = [
        { id: '1', subject: 'Test', from: [{ email: 'test@test.com' }] }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      mockEmailAI.analyzeEmailImportance.mockRejectedValue(new Error('AI service unavailable'));

      const result = await tool.execute(params);

      // Should still return emails even if analysis fails
      expect(result.emails).toHaveLength(1);
      expect(result.analysis).toBeUndefined();
      expect(result.summary).toContain('Found 1 email');
    });
  });

  describe('query parsing', () => {
    it('should parse date ranges correctly', async () => {
      const params: FindEmailsParams = {
        query: 'emails from last week'
      };

      // Mock search understanding for date range
      const lastWeekStart = new Date();
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date();
      
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: {
          start: lastWeekStart,
          end: lastWeekEnd
        },
        senders: [],
        keywords: ['last week'],
        filters: {}
      });

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: [] })
      } as any;

      await tool.execute(params);

      expect(mockNylas.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          queryParams: expect.objectContaining({
            receivedAfter: expect.any(Number),
            receivedBefore: expect.any(Number)
          })
        })
      );
    });

    it('should parse sender queries', async () => {
      const params: FindEmailsParams = {
        query: 'emails from John about the project'
      };

      // Mock search understanding for sender query
      mockEmailAI.understandSearchQuery.mockResolvedValue({
        intent: 'find',
        timeframe: undefined,
        senders: ['john@company.com'],
        keywords: ['john', 'project'],
        filters: {}
      });

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: [] })
      } as any;

      await tool.execute(params);

      expect(mockNylas.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          queryParams: expect.objectContaining({
            searchQueryNative: expect.stringContaining('from:john')
          })
        })
      );
    });
  });
});