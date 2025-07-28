import Nylas from 'nylas';
import { EmailAI } from '../ai/emailAI';
import { SmartFoldersParams, Email, ApprovalRequiredResponse } from '../types';

interface StoredFolderRule {
  id: string;
  rules: string[];
  description?: string;
}

export class SmartFoldersTool {
  private folderRulesStore: Map<string, StoredFolderRule> = new Map();

  constructor(
    private nylas: Nylas,
    private grantId: string,
    private emailAI: EmailAI
  ) {}

  async execute(params: SmartFoldersParams): Promise<any> {
    // Check if this is an approved action execution
    if (params.approved && params.action_data) {
      return this.executeApprovedAction(params);
    }

    // Parse the natural language query to understand intent
    const query = params.query.toLowerCase();
    
    if (query.includes('list') || query.includes('show') || query.includes('what folders')) {
      return this.listSmartFolders();
    } else if (query.includes('create') || query.includes('make') || query.includes('set up')) {
      return this.createSmartFolder(params);
    } else if (query.includes('update') || query.includes('change') || query.includes('modify')) {
      return this.updateSmartFolder(params);
    } else if (query.includes('apply') || query.includes('organize') || query.includes('move emails')) {
      // For apply action, check if approval is needed
      return this.handleApplyAction(params);
    } else {
      // Default to create if we can't determine intent
      return this.createSmartFolder(params);
    }
  }

  private async handleApplyAction(params: SmartFoldersParams): Promise<any> {
    // First get the preview of what would be applied
    const previewResult = await this.applySmartFolder({ ...params, dry_run: true });
    
    // If dry_run was requested or no emails to move, return the preview
    if (params.dry_run || !previewResult.preview?.total_count) {
      return previewResult;
    }
    
    // Otherwise, return an approval request
    return this.createApprovalRequest(previewResult, params);
  }

  private createApprovalRequest(
    previewResult: any,
    params: SmartFoldersParams
  ): ApprovalRequiredResponse {
    return {
      needs_approval: true,
      action_type: 'apply_smart_folder',
      action_data: {
        folder_plan: previewResult,
        original_params: params
      },
      preview: {
        summary: `Apply smart folder "${previewResult.preview.folder_name}" to ${previewResult.preview.total_count} emails`,
        details: {
          folder_name: previewResult.preview.folder_name,
          total_emails: previewResult.preview.total_count,
          sample_emails: previewResult.preview.emails_to_move.slice(0, 5),
          action: 'move_to_folder'
        },
        risks: this.assessApplyRisks(previewResult)
      }
    };
  }

  private assessApplyRisks(previewResult: any): string[] {
    const risks: string[] = [];
    
    if (previewResult.preview.total_count > 50) {
      risks.push(`Large number of emails will be moved (${previewResult.preview.total_count})`);
    }
    
    risks.push('Emails will be moved from their current folders');
    
    return risks;
  }

  private async executeApprovedAction(params: SmartFoldersParams): Promise<any> {
    if (!params.action_data?.original_params) {
      throw new Error('Missing action data in approved action');
    }
    
    const { original_params } = params.action_data;
    
    // Execute the actual action with dry_run = false
    const executeParams = { ...original_params, dry_run: false };
    
    try {
      const result = await this.applySmartFolder(executeParams);
      return {
        ...result,
        approval_executed: true
      };
    } catch (error: any) {
      throw new Error(`Failed to execute approved smart folder action: ${error.message}`);
    }
  }

  private async createSmartFolder(params: SmartFoldersParams): Promise<any> {
    try {
      // Use AI to generate folder rules from the natural language query
      const generatedRules = await this.emailAI.generateSmartFolderRules(params.query);
      
      // Use provided name or AI-generated name
      const folderName = params.folder_name || generatedRules.name;

      // Create the folder
      const folder = await this.nylas.folders.create({
        identifier: this.grantId,
        requestBody: {
          name: folderName
        }
      });

      // Store the rules
      this.folderRulesStore.set(folderName.toLowerCase(), {
        id: folder.data.id,
        rules: generatedRules.rules,
        description: generatedRules.description
      });

      return {
        success: true,
        folder_id: folder.data.id,
        folder_name: folderName,
        rules: generatedRules.rules,
        description: generatedRules.description,
        message: `Smart folder "${folderName}" created with ${generatedRules.rules.length} rules`
      };
    } catch (error: any) {
      throw new Error(`Failed to create smart folder: ${error.message}`);
    }
  }

  private async updateSmartFolder(params: SmartFoldersParams): Promise<any> {
    // Extract folder name from query
    const query = params.query.toLowerCase();
    let folderName = params.folder_name;
    
    if (!folderName) {
      // Try to extract folder name from query
      const folderMatch = query.match(/folder\s+["']?([^"']+)["']?/);
      if (folderMatch) {
        folderName = folderMatch[1];
      } else {
        throw new Error('Could not determine which folder to update. Please specify the folder name.');
      }
    }

    // Find existing folder
    const folders = await this.nylas.folders.list({
      identifier: this.grantId
    });

    const existingFolder = folders.data.find(
      f => f.name.toLowerCase() === folderName!.toLowerCase()
    );

    if (!existingFolder) {
      throw new Error(`Folder "${folderName}" not found`);
    }

    // Generate updated rules based on the query
    const updatedRules = await this.emailAI.generateSmartFolderRules(
      `Update folder "${folderName}" based on: ${params.query}`
    );

    // Update stored rules
    this.folderRulesStore.set(folderName.toLowerCase(), {
      id: existingFolder.id,
      rules: updatedRules.rules,
      description: updatedRules.description
    });

    return {
      success: true,
      folder_id: existingFolder.id,
      folder_name: folderName,
      rules: updatedRules.rules,
      description: updatedRules.description,
      message: `Smart folder "${folderName}" updated successfully`
    };
  }

  private async applySmartFolder(params: SmartFoldersParams): Promise<any> {
    // Get stored folder rules
    const folderRules = await this.getStoredFolderRules();
    
    // Find the folder mentioned in the query
    let targetFolder: StoredFolderRule | undefined;
    let folderName: string | undefined;
    
    const query = params.query.toLowerCase();
    for (const [name, rule] of folderRules) {
      if (query.includes(name)) {
        targetFolder = rule;
        folderName = name;
        break;
      }
    }

    if (!targetFolder || !folderName) {
      // If no specific folder mentioned, use AI to understand the query
      const generatedRules = await this.emailAI.generateSmartFolderRules(params.query);
      
      if (!generatedRules || !generatedRules.name) {
        throw new Error('Could not determine which folder to apply. Please specify a folder name.');
      }
      
      folderName = params.folder_name || generatedRules.name;
      
      // Check if this folder exists
      const folders = await this.nylas.folders.list({
        identifier: this.grantId
      });
      
      const existingFolder = folders.data.find(
        f => f.name.toLowerCase() === folderName!.toLowerCase()
      );
      
      if (!existingFolder) {
        return {
          success: false,
          error: `Folder "${folderName}" not found. Please create it first.`
        };
      }
      
      targetFolder = {
        id: existingFolder.id,
        rules: generatedRules.rules,
        description: generatedRules.description
      };
    }

    // Find emails matching the rules
    const matchingEmails: Email[] = [];
    
    for (const rule of targetFolder.rules) {
      const emails = await this.findEmailsByRule(rule);
      matchingEmails.push(...emails);
    }

    // Remove duplicates
    const uniqueEmails = Array.from(
      new Map(matchingEmails.map(e => [e.id, e])).values()
    );

    if (params.dry_run) {
      return {
        success: true,
        preview: {
          folder_name: folderName,
          emails_to_move: uniqueEmails.map(e => ({
            id: e.id,
            subject: e.subject,
            from: e.from[0]?.email
          })),
          total_count: uniqueEmails.length
        }
      };
    }

    // Move emails to the folder
    let movedCount = 0;
    for (const email of uniqueEmails) {
      try {
        await this.nylas.messages.update({
          identifier: this.grantId,
          messageId: email.id,
          requestBody: {
            folders: [targetFolder.id]
          }
        });
        movedCount++;
      } catch (error) {
        console.error(`Failed to move email ${email.id}:`, error);
      }
    }

    return {
      success: true,
      emails_processed: movedCount,
      message: `Applied rules to ${movedCount} emails`
    };
  }

  private async listSmartFolders(): Promise<any> {
    const folderRules = await this.getStoredFolderRules();
    
    const smartFolders = Array.from(folderRules.entries()).map(([name, rule]) => ({
      name,
      folder_id: rule.id,
      rules: rule.rules,
      description: rule.description
    }));

    return {
      smart_folders: smartFolders,
      total_count: smartFolders.length
    };
  }

  private async findEmailsByRule(rule: string): Promise<Email[]> {
    const queryParams: any = {};
    
    // Parse simple rules
    if (rule.includes('from:')) {
      const fromMatch = rule.match(/from:([^\s]+)/);
      if (fromMatch) {
        queryParams.searchQueryNative = rule;
      }
    } else if (rule.includes('subject contains')) {
      queryParams.searchQueryNative = rule;
    } else {
      // For complex rules, use the rule as-is
      queryParams.searchQueryNative = rule;
    }

    queryParams.limit = 100;

    try {
      const messages = await this.nylas.messages.list({
        identifier: this.grantId,
        queryParams
      });

      return messages.data as Email[];
    } catch (error) {
      console.error(`Failed to find emails for rule "${rule}":`, error);
      return [];
    }
  }

  private async getStoredFolderRules(): Promise<Map<string, StoredFolderRule>> {
    // In a real implementation, this would persist to a database
    // For now, we'll try to reconstruct from folder names
    if (this.folderRulesStore.size === 0) {
      try {
        const folders = await this.nylas.folders.list({
          identifier: this.grantId
        });

        // Look for folders that seem to be smart folders
        // In production, you'd store this metadata properly
        folders.data.forEach(folder => {
          if (!folder.attributes?.includes('\\System')) {
            // Assume user-created folders might be smart folders
            this.folderRulesStore.set(folder.name.toLowerCase(), {
              id: folder.id,
              rules: [], // Would need to retrieve stored rules
              description: `Smart folder: ${folder.name}`
            });
          }
        });
      } catch (error) {
        console.error('Failed to load folder rules:', error);
      }
    }

    return this.folderRulesStore;
  }
}