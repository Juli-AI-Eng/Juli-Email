import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ManageEmailTool } from '../../../src/tools/manageEmail';
import { EmailAI } from '../../../src/ai/emailAI';
import Nylas from 'nylas';
import { ManageEmailParams, Email } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/ai/emailAI');
jest.mock('nylas');

describe('ManageEmailTool', () => {
  let tool: ManageEmailTool;
  let mockEmailAI: jest.Mocked<EmailAI>;
  let mockNylas: jest.Mocked<Nylas>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockEmailAI = new EmailAI() as jest.Mocked<EmailAI>;
    mockNylas = new Nylas({ apiKey: 'test' }) as jest.Mocked<Nylas>;
    
    // Mock contacts.list for contact lookup
    mockNylas.contacts = {
      list: jest.fn<any>().mockResolvedValue({ data: [] })
    } as any;
    
    // Mock grants.find for sender info
    mockNylas.grants = {
      find: jest.fn<any>().mockResolvedValue({
        data: { email: 'sender@example.com' }
      })
    } as any;
    
    tool = new ManageEmailTool(mockNylas, 'grant123', mockEmailAI, { userName: 'Test User', userEmail: 'testuser@example.com' });
  });

  describe('send email', () => {
    it('should return approval request for sending new email', async () => {
      const params: ManageEmailParams = {
        action: 'send',
        query: 'send an email to john@example.com about the meeting tomorrow',
        require_approval: true
      };

      // Mock AI understanding
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'send',
        recipients: ['john@example.com'],
        subject: 'Meeting Tomorrow',
        key_points: ['meeting scheduled for tomorrow'],
        urgency: 'normal',
        tone: 'professional'
      });

      // Mock email generation
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['john@example.com'],
        subject: 'Meeting Tomorrow',
        body: 'Hi John,\n\nI wanted to confirm our meeting scheduled for tomorrow...',
        cc: undefined,
        bcc: undefined
      });

      const result = await tool.execute(params);

      expect(result.needs_approval).toBe(true);
      expect(result.action_type).toBe('send_email');
      expect(result.action_data).toEqual({
        email_content: {
          to: ['john@example.com'],
          subject: 'Meeting Tomorrow',
          body: 'Hi John,\n\nI wanted to confirm our meeting scheduled for tomorrow...',
          cc: undefined,
          bcc: undefined
        },
        original_params: {
          action: 'send',
          query: 'send an email to john@example.com about the meeting tomorrow',
          context_message_id: undefined
        },
        intent: {
          intent: 'send',
          recipients: ['john@example.com'],
          subject: 'Meeting Tomorrow',
          key_points: ['meeting scheduled for tomorrow'],
          urgency: 'normal',
          tone: 'professional'
        }
      });
      expect(result.preview.summary).toContain('john@example.com');
      expect(mockEmailAI.understandQuery).toHaveBeenCalledWith(params.query, undefined);
      expect(mockEmailAI.generateEmailContent).toHaveBeenCalled();
    });

    it('should execute approved email action', async () => {
      const emailContent = {
        to: ['john@example.com'],
        subject: 'Meeting Tomorrow',
        body: 'Hi John,\n\nI wanted to confirm our meeting scheduled for tomorrow...',
        cc: undefined,
        bcc: undefined
      };

      const params: ManageEmailParams = {
        action: 'send',
        query: 'send an email to john@example.com about the meeting tomorrow',
        approved: true,
        action_data: {
          email_content: emailContent,
          original_params: {
            action: 'send',
            query: 'send an email to john@example.com about the meeting tomorrow'
          }
        }
      };

      // Mock Nylas send
      const mockMessage = { data: { id: 'msg123' } };
      mockNylas.messages = {
        send: jest.fn<any>().mockResolvedValue(mockMessage)
      } as any;

      const result = await tool.execute(params);

      expect(result.success).toBe(true);
      expect(result.message_id).toBe('msg123');
      expect(mockNylas.messages.send).toHaveBeenCalledWith({
        identifier: 'grant123',
        requestBody: {
          to: [{ email: 'john@example.com' }],
          subject: 'Meeting Tomorrow',
          body: 'Hi John,<br><br>I wanted to confirm our meeting scheduled for tomorrow...',
          cc: undefined,
          bcc: undefined,
          replyToMessageId: undefined
        }
      });
    });

    it('should skip approval when require_approval is false', async () => {
      const params: ManageEmailParams = {
        action: 'send',
        query: 'send test email to myself',
        require_approval: false
      };

      // Mock AI understanding
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'send',
        recipients: ['me@example.com'],
        subject: 'Test',
        key_points: ['test email'],
        urgency: 'low',
        tone: 'casual'
      });

      // Mock email generation
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['me@example.com'],
        subject: 'Test',
        body: 'This is a test email.',
        cc: undefined,
        bcc: undefined
      });

      // Mock Nylas send
      const mockMessage = { data: { id: 'msg123' } };
      mockNylas.messages = {
        send: jest.fn<any>().mockResolvedValue(mockMessage)
      } as any;

      const result = await tool.execute(params);

      expect(result.success).toBe(true);
      expect(result.message_id).toBe('msg123');
      expect(mockNylas.messages.send).toHaveBeenCalled();
      expect(result).not.toHaveProperty('needs_approval');
    });
  });

  describe('reply to email', () => {
    it('should handle reply with context message', async () => {
      const params: ManageEmailParams = {
        action: 'reply',
        query: 'reply thanking for the proposal',
        context_message_id: 'msg456'
      };

      // Mock finding the original message
      const originalMessage: Email = {
        id: 'msg456',
        subject: 'Project Proposal',
        from: [{ email: 'sarah@company.com', name: 'Sarah' }],
        body: 'Here is our proposal...',
        thread_id: 'thread123'
      };

      mockNylas.messages = {
        find: jest.fn<any>().mockResolvedValue({ data: originalMessage }),
        send: jest.fn<any>().mockResolvedValue({ data: { id: 'msg789' } })
      } as any;

      // Mock AI understanding with context
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'reply',
        recipients: ['sarah@company.com'],
        subject: 'Re: Project Proposal',
        key_points: ['thank you for the proposal'],
        urgency: 'normal',
        tone: 'grateful'
      });

      // Mock email generation
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['sarah@company.com'],
        subject: 'Re: Project Proposal',
        body: 'Hi Sarah,\n\nThank you for sending the proposal...',
        in_reply_to: 'msg456'
      });

      // Skip approval for this test
      const paramsNoApproval = { ...params, require_approval: false };
      const result = await tool.execute(paramsNoApproval);

      expect(result.success).toBe(true);
      expect(mockNylas.messages.find).toHaveBeenCalledWith({
        identifier: 'grant123',
        messageId: 'msg456'
      });
      expect(mockEmailAI.understandQuery).toHaveBeenCalledWith(
        params.query,
        { 
          senderEmail: 'sarah@company.com',
          originalMessage: originalMessage
        }
      );
    });

    it('should find message automatically when no context_message_id provided', async () => {
      const params: ManageEmailParams = {
        action: 'reply',
        query: 'reply to Sarah about the budget',
        require_approval: false
      };

      // Mock message search
      const searchResults = {
        data: [{
          id: 'msg999',
          subject: 'Budget Planning',
          from: [{ email: 'sarah@company.com' }],
          date: Date.now() / 1000
        }]
      };

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue(searchResults),
        find: jest.fn<any>().mockResolvedValue({ data: searchResults.data[0] }),
        send: jest.fn<any>().mockResolvedValue({ data: { id: 'msg1000' } })
      } as any;

      // Mock AI understanding
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'reply',
        recipients: ['sarah@company.com'],
        subject: 'Re: Budget Planning',
        key_points: ['budget discussion'],
        urgency: 'normal',
        tone: 'professional'
      });

      // Mock email generation
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['sarah@company.com'],
        subject: 'Re: Budget Planning',
        body: 'Hi Sarah,\n\nRegarding the budget...'
      });

      const result = await tool.execute(params);

      expect(result.success).toBe(true);
      expect(mockNylas.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'grant123',
          queryParams: expect.objectContaining({
            searchQueryNative: 'from:Sarah'
          })
        })
      );
    });
  });

  describe('forward email', () => {
    it('should forward email with added context', async () => {
      const params: ManageEmailParams = {
        action: 'forward',
        query: 'forward to the dev team with a summary',
        context_message_id: 'msg111'
      };

      // Mock original message
      const originalMessage: Email = {
        id: 'msg111',
        subject: 'Production Issue',
        from: [{ email: 'alerts@system.com' }],
        body: 'Alert: Database connection issues detected...'
      };

      mockNylas.messages = {
        find: jest.fn<any>().mockResolvedValue({ data: originalMessage }),
        send: jest.fn<any>().mockResolvedValue({ data: { id: 'msg222' } })
      } as any;

      // Mock AI understanding
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'forward',
        recipients: ['dev-team@company.com'],
        subject: 'Fwd: Production Issue',
        key_points: ['forward with summary', 'database issues'],
        urgency: 'high',
        tone: 'professional'
      });

      // Mock email generation with forwarded content
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['dev-team@company.com'],
        subject: 'Fwd: Production Issue - Database Connection Alert',
        body: 'Team,\n\nForwarding this alert for immediate attention.\n\nSummary: Database connection issues in production.\n\n--- Original Message ---\nAlert: Database connection issues detected...'
      });

      const paramsNoApproval = { ...params, require_approval: false };
      const result = await tool.execute(paramsNoApproval);

      expect(result.success).toBe(true);
      expect(mockEmailAI.generateEmailContent).toHaveBeenCalledWith(
        expect.anything(),
        originalMessage,
        {},
        expect.anything() // sender info
      );
    });
  });

  describe('draft email', () => {
    it('should create draft instead of sending', async () => {
      const params: ManageEmailParams = {
        action: 'draft',
        query: 'draft a follow-up email about the project status'
      };

      // Mock AI understanding
      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'send',
        recipients: [],
        subject: 'Project Status Update',
        key_points: ['project status', 'follow-up'],
        urgency: 'normal',
        tone: 'professional'
      });

      // Mock email generation
      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: [],
        subject: 'Project Status Update',
        body: 'Dear Team,\n\nI wanted to provide an update on the project status...'
      });

      // Mock draft creation
      mockNylas.drafts = {
        create: jest.fn<any>().mockResolvedValue({ 
          data: { id: 'draft123' } 
        })
      } as any;

      const result = await tool.execute(params);

      expect(result.success).toBe(true);
      expect(result.draft_id).toBe('draft123');
      expect(result.message).toContain('Draft created');
      expect(mockNylas.drafts.create).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle AI understanding errors', async () => {
      const params: ManageEmailParams = {
        action: 'send',
        query: 'ambiguous request'
      };

      mockEmailAI.understandQuery.mockRejectedValue(
        new Error('Could not understand intent')
      );

      await expect(tool.execute(params)).rejects.toThrow('Could not understand intent');
    });

    it('should handle Nylas API errors', async () => {
      const params: ManageEmailParams = {
        action: 'send',
        query: 'send email',
        require_approval: false
      };

      mockEmailAI.understandQuery.mockResolvedValue({
        intent: 'send',
        recipients: ['test@example.com'],
        subject: 'Test',
        key_points: ['test'],
        urgency: 'normal',
        tone: 'casual'
      });

      mockEmailAI.generateEmailContent.mockResolvedValue({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Test email'
      });

      mockNylas.messages = {
        send: jest.fn<any>().mockRejectedValue(new Error('API quota exceeded'))
      } as any;

      await expect(tool.execute(params)).rejects.toThrow('API quota exceeded');
    });
  });
});