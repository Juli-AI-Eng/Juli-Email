import Nylas from 'nylas';
import { EmailAI } from '../ai/emailAI';
import { 
  OrganizeInboxParams, 
  Email, 
  EmailAnalysis,
  ApprovalRequiredResponse
} from '../types';

export class OrganizeInboxTool {
  constructor(
    private nylas: Nylas,
    private grantId: string,
    private emailAI: EmailAI
  ) {}

  async execute(params: OrganizeInboxParams): Promise<any> {
    // Check if this is an approved action execution
    if (params.approved && params.action_data) {
      return this.executeApprovedOrganization(params);
    }

    // First, always run in preview mode to gather the plan
    const planResult = await this.createOrganizationPlan(params);
    
    // If dry_run is true or there are no actions, return the preview
    if (params.dry_run || planResult.total_actions === 0) {
      return planResult;
    }
    
    // Otherwise, return an approval request
    return this.createApprovalRequest(planResult, params);
  }

  private async createOrganizationPlan(params: OrganizeInboxParams): Promise<any> {
    const result = {
      organized_count: 0,
      actions_taken: [] as string[],
      preview_actions: [] as string[],
      errors: [] as string[],
      total_actions: 0,
      organization_plan: null as any
    };

    try {
      // Use AI to understand the organization instruction
      const intent = await this.emailAI.understandOrganizationIntent(params.instruction);
      
      // Get emails to organize
      const messages = await this.nylas.messages.list({
        identifier: this.grantId,
        queryParams: {
          limit: params.scope?.limit || 100
        }
      });
      
      const emails = messages.data as Email[];
      
      // Apply each AI-generated rule to the emails
      for (const email of emails) {
        for (const rule of intent.rules) {
          if (this.emailMatchesCondition(email, rule.condition)) {
            const action = `${rule.action} email "${email.subject}" from ${email.from[0]?.email}`;
            if (rule.target) {
              result.preview_actions.push(`${action} to folder "${rule.target}"`);
            } else {
              result.preview_actions.push(action);
            }
            result.organized_count++;
            break; // Only apply first matching rule
          }
        }
      }
      
      result.organization_plan = intent;
      result.total_actions = result.preview_actions.length;
    } catch (error: any) {
      result.errors.push(`Organization planning failed: ${error.message}`);
    }

    return result;
  }

  private createApprovalRequest(
    planResult: any,
    params: OrganizeInboxParams
  ): ApprovalRequiredResponse {
    const actionSummary = this.summarizeActions(planResult.preview_actions);
    
    return {
      needs_approval: true,
      action_type: 'organize_inbox',
      action_data: {
        organization_plan: planResult,
        original_params: params
      },
      preview: {
        summary: `Organize ${planResult.total_actions} emails based on: "${params.instruction}"`,
        details: {
          instruction: params.instruction,
          total_actions: planResult.total_actions,
          actions_by_type: actionSummary,
          preview_actions: planResult.preview_actions.slice(0, 10), // First 10 for preview
          organization_rules: planResult.organization_plan?.rules || []
        },
        risks: this.assessOrganizationRisks(planResult, params)
      }
    };
  }

  private summarizeActions(actions: string[]): Record<string, number> {
    const summary: Record<string, number> = {};
    
    actions.forEach(action => {
      if (action.includes('move')) summary.move = (summary.move || 0) + 1;
      if (action.includes('archive')) summary.archive = (summary.archive || 0) + 1;
      if (action.includes('star')) summary.star = (summary.star || 0) + 1;
      if (action.includes('mark')) summary.mark_read = (summary.mark_read || 0) + 1;
      if (action.includes('delete')) summary.delete = (summary.delete || 0) + 1;
    });
    
    return summary;
  }

  private assessOrganizationRisks(
    planResult: any,
    params: OrganizeInboxParams
  ): string[] {
    const risks: string[] = [];
    
    if (planResult.total_actions > 50) {
      risks.push(`Large number of emails will be affected (${planResult.total_actions})`);
    }
    
    const deleteCount = planResult.preview_actions.filter((a: string) => 
      a.toLowerCase().includes('delete')
    ).length;
    
    if (deleteCount > 0) {
      risks.push(`${deleteCount} emails will be permanently deleted`);
    }
    
    // Always warn about AI interpretation since we're using natural language
    risks.push('AI-interpreted organization rules based on your instruction');
    
    return risks;
  }

  private async executeApprovedOrganization(params: OrganizeInboxParams): Promise<any> {
    if (!params.action_data?.organization_plan || !params.action_data?.original_params) {
      throw new Error('Missing organization plan in approved action');
    }
    
    const { organization_plan } = params.action_data;
    const result = {
      organized_count: 0,
      actions_taken: [] as string[],
      errors: [] as string[]
    };
    
    try {
      // Execute the organization plan that was generated during preview
      await this.executeOrganizationPlan(organization_plan, result);
      
      return {
        ...result,
        approval_executed: true,
        message: `Successfully organized ${result.organized_count} emails`
      };
    } catch (error: any) {
      throw new Error(`Failed to execute approved organization: ${error.message}`);
    }
  }

  private async executeOrganizationPlan(
    plan: any,
    result: any
  ): Promise<void> {
    try {
      // Get emails to organize
      const messages = await this.nylas.messages.list({
        identifier: this.grantId,
        queryParams: {
          limit: 100
        }
      });
      
      const emails = messages.data as Email[];
      const folders = await this.getFolderMap();
      
      // Apply each rule from the plan
      for (const email of emails) {
        for (const rule of plan.rules || []) {
          if (this.emailMatchesCondition(email, rule.condition)) {
            switch (rule.action.toLowerCase()) {
              case 'move to folder':
                if (rule.target) {
                  const folderId = await this.ensureFolder(rule.target, folders);
                  await this.moveToFolder(email.id, folderId);
                  result.actions_taken.push(`Moved "${email.subject}" to ${rule.target}`);
                  result.organized_count++;
                }
                break;
                
              case 'archive':
                const archiveFolderId = await this.getArchiveFolderId();
                await this.moveToFolder(email.id, archiveFolderId);
                result.actions_taken.push(`Archived "${email.subject}"`);
                result.organized_count++;
                break;
                
              case 'star':
              case 'flag':
                await this.starEmail(email.id);
                result.actions_taken.push(`Starred "${email.subject}"`);
                result.organized_count++;
                break;
                
              case 'mark read':
              case 'mark as read':
                await this.markAsRead(email.id);
                result.actions_taken.push(`Marked "${email.subject}" as read`);
                result.organized_count++;
                break;
                
              case 'delete':
                await this.deleteEmail(email.id);
                result.actions_taken.push(`Deleted "${email.subject}"`);
                result.organized_count++;
                break;
            }
            break; // Only apply first matching rule per email
          }
        }
      }
    } catch (error: any) {
      throw new Error(`Organization execution failed: ${error.message}`);
    }
  }

  private emailMatchesCondition(email: Email, condition: string): boolean {
    const lowerCondition = condition.toLowerCase();
    
    // Check subject contains
    if (lowerCondition.includes('subject contains')) {
      const searchTerm = lowerCondition.split('subject contains')[1].trim();
      return email.subject.toLowerCase().includes(searchTerm);
    }
    
    // Check from email
    if (lowerCondition.includes('from')) {
      const searchTerm = lowerCondition.split('from')[1].trim();
      return email.from.some(f => 
        f.email.toLowerCase().includes(searchTerm) ||
        (f.name && f.name.toLowerCase().includes(searchTerm))
      );
    }
    
    // Check if unread
    if (lowerCondition === 'unread') {
      return email.unread === true;
    }
    
    // Check if starred
    if (lowerCondition === 'starred' || lowerCondition === 'important') {
      return email.starred === true;
    }
    
    // Check date conditions
    if (lowerCondition.includes('older than')) {
      const daysMatch = lowerCondition.match(/older than (\d+) days?/);
      if (daysMatch && email.date) {
        const days = parseInt(daysMatch[1]);
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        return email.date * 1000 < cutoffTime;
      }
    }
    
    // Default: check if any part of the email contains the condition text
    return email.subject.toLowerCase().includes(lowerCondition) ||
           email.snippet?.toLowerCase().includes(lowerCondition) || false;
  }

  private async getFolderMap(): Promise<Map<string, string>> {
    const folders = await this.nylas.folders.list({
      identifier: this.grantId
    });

    const folderMap = new Map<string, string>();
    folders.data.forEach(folder => {
      folderMap.set(folder.name.toLowerCase(), folder.id);
    });

    return folderMap;
  }

  private async ensureFolder(name: string, folderMap: Map<string, string>): Promise<string> {
    const lowerName = name.toLowerCase();
    if (folderMap.has(lowerName)) {
      return folderMap.get(lowerName)!;
    }

    try {
      // Create the folder
      const newFolder = await this.nylas.folders.create({
        identifier: this.grantId,
        requestBody: {
          name: name
        }
      });

      const folderId = newFolder.data.id;
      folderMap.set(lowerName, folderId);
      return folderId;
    } catch (error: any) {
      throw new Error(`Failed to create folder ${name}: ${error.message}`);
    }
  }

  private async getArchiveFolderId(): Promise<string> {
    const folders = await this.nylas.folders.list({
      identifier: this.grantId
    });

    const archiveFolder = folders.data.find(f => 
      f.attributes?.includes('\\Archive') || 
      f.name.toLowerCase() === 'archive'
    );

    if (!archiveFolder) {
      throw new Error('Archive folder not found');
    }

    return archiveFolder.id;
  }

  private async moveToFolder(messageId: string, folderId: string): Promise<void> {
    await this.nylas.messages.update({
      identifier: this.grantId,
      messageId,
      requestBody: {
        folders: [folderId]
      }
    });
  }

  private async starEmail(messageId: string): Promise<void> {
    await this.nylas.messages.update({
      identifier: this.grantId,
      messageId,
      requestBody: {
        starred: true
      }
    });
  }

  private async markAsRead(messageId: string): Promise<void> {
    await this.nylas.messages.update({
      identifier: this.grantId,
      messageId,
      requestBody: {
        unread: false
      }
    });
  }

  private async deleteEmail(messageId: string): Promise<void> {
    await this.nylas.messages.destroy({
      identifier: this.grantId,
      messageId
    });
  }

  private async findOldEmails(): Promise<Email[]> {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    
    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        receivedBefore: thirtyDaysAgo,
        unread: false,
        limit: 50
      }
    });

    return messages.data as Email[];
  }

  private async findEmailsByCondition(condition: string): Promise<Email[]> {
    const queryParams: any = {};
    
    // Parse condition
    if (condition.startsWith('from:')) {
      const from = condition.substring(5);
      queryParams.searchQueryNative = `from:${from}`;
    } else if (condition === 'older_than:30d') {
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      queryParams.receivedBefore = thirtyDaysAgo;
    } else {
      queryParams.searchQueryNative = condition;
    }

    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams
    });

    return messages.data as Email[];
  }

  private filterEmailsByCondition(emails: Email[], condition: string): Email[] {
    const lowerCondition = condition.toLowerCase();
    
    if (lowerCondition.includes('subject contains')) {
      const searchTerm = lowerCondition.split('subject contains')[1].trim();
      return emails.filter(e => e.subject.toLowerCase().includes(searchTerm));
    }
    
    if (lowerCondition.includes('from')) {
      const searchTerm = lowerCondition.split('from')[1].trim();
      return emails.filter(e => 
        e.from.some(f => f.email.toLowerCase().includes(searchTerm))
      );
    }

    return [];
  }
}