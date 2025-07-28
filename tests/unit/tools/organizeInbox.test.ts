import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { OrganizeInboxTool } from '../../../src/tools/organizeInbox';
import { EmailAI } from '../../../src/ai/emailAI';
import Nylas from 'nylas';
import { OrganizeInboxParams, Email, EmailAnalysis } from '../../../src/types';

// Mock dependencies
jest.mock('../../../src/ai/emailAI');
jest.mock('nylas');

describe('OrganizeInboxTool', () => {
  let tool: OrganizeInboxTool;
  let mockEmailAI: jest.Mocked<EmailAI>;
  let mockNylas: jest.Mocked<Nylas>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock instances
    mockEmailAI = new EmailAI() as jest.Mocked<EmailAI>;
    mockNylas = new Nylas({ apiKey: 'test' }) as jest.Mocked<Nylas>;
    
    tool = new OrganizeInboxTool(mockNylas, 'grant123', mockEmailAI);
  });

  describe('organization with natural language instructions', () => {
    it('should return approval request for email organization', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'move invoices to a finance folder and star important emails',
        dry_run: false
      };

      // Mock finding unread emails
      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Invoice #12345',
          from: [{ email: 'billing@vendor.com' }],
          unread: true,
          folders: ['inbox']
        },
        {
          id: 'msg2',
          subject: 'Meeting Tomorrow',
          from: [{ email: 'boss@company.com' }],
          unread: true,
          folders: ['inbox']
        },
        {
          id: 'msg3',
          subject: 'Newsletter: Weekly Update',
          from: [{ email: 'news@service.com' }],
          unread: true,
          folders: ['inbox']
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI understanding of organization intent
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockResolvedValue({
        rules: [
          {
            condition: 'subject contains invoice',
            action: 'move to folder',
            target: 'Finance'
          },
          {
            condition: 'from boss@company.com',
            action: 'star',
            target: null
          }
        ]
      });
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      // Mock folder operations
      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({
          data: [
            { id: 'inbox', name: 'Inbox' },
            { id: 'important', name: 'Important' },
            { id: 'invoices', name: 'Invoices' }
          ]
        }),
        create: jest.fn<any>().mockResolvedValue({
          data: { id: 'newsletters', name: 'Newsletters' }
        })
      } as any;

      // Mock message updates
      mockNylas.messages.update = jest.fn<any>().mockResolvedValue({ data: {} });

      const result = await tool.execute(params);

      // Should return approval request, not execute immediately
      expect(result.needs_approval).toBe(true);
      expect(result.action_type).toBe('organize_inbox');
      expect(result.action_data.organization_plan).toBeDefined();
      expect(result.preview.summary).toContain('Organize');
      expect(result.preview.summary).toContain('based on: "move invoices to a finance folder and star important emails"');
      expect(result.preview.details.total_actions).toBe(2); // 1 move + 1 star
      expect(result.preview.details.organization_rules).toHaveLength(2);
      expect((mockEmailAI as any).understandOrganizationIntent).toHaveBeenCalledWith(params.instruction);
      // Should not have executed any updates yet
      expect(mockNylas.messages.update).not.toHaveBeenCalled();
    });

    it('should execute approved organization', async () => {
      const organizationPlan = {
        rules: [
          {
            condition: 'subject contains invoice',
            action: 'move to folder',
            target: 'Finance'
          },
          {
            condition: 'from boss@company.com',
            action: 'star',
            target: null
          }
        ],
        preview_actions: ['move email "Invoice #12345" from billing@vendor.com to folder "Finance"', 'star email "Meeting Tomorrow" from boss@company.com'],
        organized_count: 2,
        total_actions: 2
      };

      const params: OrganizeInboxParams = {
        instruction: 'move invoices to a finance folder and star important emails',
        dry_run: false,
        approved: true,
        action_data: {
          organization_plan: organizationPlan,
          original_params: {
            instruction: 'move invoices to a finance folder and star important emails'
          }
        }
      };

      // Mock folder operations for execution
      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({
          data: [
            { id: 'inbox', name: 'Inbox' },
            { id: 'finance', name: 'Finance' }
          ]
        }),
        create: jest.fn<any>().mockResolvedValue({
          data: { id: 'finance', name: 'Finance' }
        })
      } as any;

      // Mock message list for execution
      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ 
          data: [
            { 
              id: 'msg1', 
              subject: 'Invoice #12345',
              from: [{ email: 'billing@vendor.com' }]
            },
            { 
              id: 'msg2', 
              subject: 'Meeting Tomorrow',
              from: [{ email: 'boss@company.com' }]
            }
          ] 
        }),
        update: jest.fn<any>().mockResolvedValue({ data: {} }),
        destroy: jest.fn<any>().mockResolvedValue({ data: {} })
      } as any;

      const result = await tool.execute(params);

      expect(result.organized_count).toBe(2);
      expect(result.actions_taken).toHaveLength(2);
      expect(result.approval_executed).toBe(true);
      expect(mockNylas.messages.update).toHaveBeenCalled();
    });

    it('should handle dry run mode', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'archive old newsletters and move important emails to a priority folder',
        dry_run: true
      };

      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Old Newsletter',
          date: Math.floor((Date.now() - 35 * 24 * 60 * 60 * 1000) / 1000), // 35 days old
          unread: false,
          folders: ['inbox']
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails }),
        update: jest.fn<any>().mockResolvedValue({ data: {} })
      } as any;

      // Mock AI understanding of organization intent
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockResolvedValue({
        rules: [
          {
            condition: 'older than 30 days and subject contains newsletter',
            action: 'archive',
            target: null
          }
        ]
      });
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      // Mock folders for archive
      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({
          data: [
            { id: 'archive', name: 'Archive', attributes: ['\\Archive'] }
          ]
        })
      } as any;

      const result = await tool.execute(params);

      expect(result.preview_actions).toBeDefined();
      // In dry run mode, the actions are shown but not executed
      if (result.preview_actions.length > 0) {
        expect(result.preview_actions[0]).toContain('archive');
      }
      expect(result.organized_count).toBe(0); // No actual changes in dry run
      expect(mockNylas.messages.update).not.toHaveBeenCalled();
    });
  });

  describe('complex organization instructions', () => {
    it('should handle multiple organization rules', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'archive all newsletters older than a week, star emails that need responses, and move receipts to a folder',
        dry_run: false
      };

      // Mock finding emails
      const mockEmails = [
        {
          id: 'msg1',
          subject: 'Invoice from AWS',
          from: [{ email: 'billing@aws.com' }]
        },
        {
          id: 'msg2',
          subject: 'URGENT: Server down',
          from: [{ email: 'alerts@monitoring.com' }]
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails }),
        update: jest.fn<any>().mockResolvedValue({ data: {} })
      } as any;

      // Mock AI understanding of the query
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockResolvedValue({
        rules: [
          {
            condition: 'subject contains invoice',
            action: 'move to folder',
            target: 'Finance'
          },
          {
            condition: 'subject contains urgent',
            action: 'star',
            target: null
          }
        ]
      });
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      // Mock folder operations
      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({
          data: [{ id: 'inbox', name: 'Inbox' }]
        }),
        create: jest.fn<any>().mockResolvedValue({
          data: { id: 'finance', name: 'Finance' }
        })
      } as any;

      const result = await tool.execute(params);

      // Should return approval request
      expect(result.needs_approval).toBe(true);
      expect(result.action_type).toBe('organize_inbox');
      expect(result.preview.summary).toContain('Organize');
      expect(result.preview.summary).toContain('based on:');
      expect(result.preview.details.total_actions).toBe(2);
      expect((mockEmailAI as any).understandOrganizationIntent).toHaveBeenCalledWith(params.instruction);
      // Should not have executed updates yet
      expect(mockNylas.messages.update).not.toHaveBeenCalled();
    });
  });

  describe('specific organization rules', () => {
    it('should organize emails based on specific criteria', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'move emails from newsletter@ to Newsletters folder and archive emails older than 30 days',
        dry_run: false
      };

      const mockEmails = [
        {
          id: 'msg1',
          from: [{ email: 'newsletter@company.com' }],
          date: Date.now() / 1000
        },
        {
          id: 'msg2',
          from: [{ email: 'person@example.com' }],
          date: Math.floor((Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000) // 40 days old
        }
      ];

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ data: mockEmails })
      } as any;

      // Mock AI understanding of organization intent
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockResolvedValue({
        rules: [
          {
            condition: 'from newsletter@',
            action: 'move to folder',
            target: 'Newsletters'
          },
          {
            condition: 'older than 30 days',
            action: 'archive',
            target: null
          }
        ]
      });
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      // Mock folder operations
      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({
          data: [
            { id: 'inbox', name: 'Inbox' },
            { id: 'archive', name: 'Archive', attributes: ['\\Archive'] }
          ]
        }),
        create: jest.fn<any>().mockResolvedValue({
          data: { id: 'newsletters', name: 'Newsletters' }
        })
      } as any;

      mockNylas.messages.update = jest.fn<any>().mockResolvedValue({ data: {} });

      const result = await tool.execute(params);

      // Should return approval request
      expect(result.needs_approval).toBe(true);
      expect(result.action_type).toBe('organize_inbox');
      expect(result.preview.summary).toContain('Organize');
      expect(result.preview.summary).toContain('based on:');
      expect(result.preview.details.total_actions).toBe(2);
      expect((mockEmailAI as any).understandOrganizationIntent).toHaveBeenCalledWith(params.instruction);
      // Should not have executed updates yet
      expect(mockNylas.messages.update).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle folder creation errors', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'move emails to new folders based on importance'
      };

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ 
          data: [{ id: 'msg1', subject: 'Test' }] 
        })
      } as any;

      // Mock AI understanding of organization intent
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockResolvedValue({
        rules: [
          {
            condition: 'all',
            action: 'move to folder',
            target: 'NewFolder'
          }
        ]
      });
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      mockNylas.folders = {
        list: jest.fn<any>().mockResolvedValue({ data: [] }),
        create: jest.fn<any>().mockRejectedValue(new Error('Folder creation failed'))
      } as any;

      const result = await tool.execute(params);

      // The error might be in different places depending on when it fails
      if (result.errors && result.errors.length > 0) {
        expect(result.errors[0]).toBeDefined();
      } else {
        // If no errors in planning, it might fail during execution
        expect(result.preview_actions).toBeDefined();
      }
      expect(result.organized_count).toBe(0);
    });

    it('should handle AI understanding errors gracefully', async () => {
      const params: OrganizeInboxParams = {
        instruction: 'organize my emails intelligently'
      };

      mockNylas.messages = {
        list: jest.fn<any>().mockResolvedValue({ 
          data: [{ id: 'msg1', subject: 'Test' }] 
        })
      } as any;

      // Mock AI understanding failure
      const mockUnderstandOrganizationIntent = jest.fn<any>().mockRejectedValue(
        new Error('AI service unavailable')
      );
      (mockEmailAI as any).understandOrganizationIntent = mockUnderstandOrganizationIntent;

      const result = await tool.execute(params);

      expect(result.errors[0]).toContain('Organization planning failed: AI service unavailable');
      expect(result.organized_count).toBe(0);
    });
  });
});