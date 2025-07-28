import Nylas from 'nylas';
import { EmailAI } from '../ai/emailAI';
import { 
  FindEmailsParams, 
  Email, 
  EmailAnalysis,
  ActionItem,
  EmailIntent
} from '../types';

export class FindEmailsTool {
  constructor(
    private nylas: Nylas,
    private grantId: string,
    private emailAI: EmailAI
  ) {}

  async execute(params: FindEmailsParams): Promise<any> {
    try {
      // Use AI to understand the search query
      const searchIntent = await this.emailAI.understandSearchQuery(params.query);
      
      // Build Nylas search parameters from AI understanding
      const queryParams = await this.buildSearchParamsFromIntent(searchIntent);
      queryParams.limit = params.limit || 2;

      // Search emails
      const messages = await this.nylas.messages.list({
        identifier: this.grantId,
        queryParams
      });

      const emails = messages.data as Email[];

      // Handle empty results
      if (emails.length === 0) {
        return {
          emails: [],
          summary: 'No emails found matching your query.',
          total_count: 0
        };
      }

      // Perform analysis based on type
      let result: any = {
        emails,
        total_count: emails.length
      };

      switch (params.analysis_type) {
        case 'summary':
          // Summary only - no email content, just AI-powered natural language summary
          console.log(`Generating AI summary for ${emails.length} emails...`);
          try {
            const aiSummary = await this.emailAI.generateAggregatedSummary(emails);
            console.log('AI summary generated successfully');
            return {
              summary: aiSummary,
              total_count: emails.length,
              query: params.query
            };
          } catch (error) {
            console.error('AI summary generation failed:', error);
            // Fallback to basic summary if AI fails
            const basicSummary = await this.generateBasicSummary(emails, params.query);
            return {
              summary: basicSummary,
              total_count: emails.length,
              query: params.query
            };
          }
        
        case 'full':
          // Full email content without any analysis
          // Already set in result initialization
          break;

        case 'detailed':
          try {
            const analysis = await this.emailAI.analyzeEmailImportance(emails);
            result.analysis = analysis;
            result.summary = this.generateDetailedSummary(emails, analysis);
          } catch (error) {
            console.error('AI analysis failed:', error);
            // Simple summary when AI fails
            result.summary = `Found ${emails.length} email${emails.length !== 1 ? 's' : ''} matching "${params.query}".`;
          }
          break;

        case 'action_items':
          const actionAnalysis = await this.emailAI.analyzeEmailImportance(emails);
          const actionItems = await this.extractAllActionItems(emails);
          result.analysis = actionAnalysis;
          result.action_items = actionItems;
          result.summary = this.generateActionSummary(emails, actionItems);
          
          // Filter to only emails that need response if query mentions it
          if (params.query.toLowerCase().includes('respond') || 
              params.query.toLowerCase().includes('reply')) {
            result.emails = await this.filterUnrepliedEmails(emails);
            result.total_count = result.emails.length;
          }
          break;

        case 'priority':
          const priorityAnalysis = await this.emailAI.analyzeEmailImportance(emails);
          // Sort by importance score
          const sortedAnalysis = priorityAnalysis.sort(
            (a, b) => b.importance_score - a.importance_score
          );
          result.analysis = sortedAnalysis;
          result.emails = this.sortEmailsByAnalysis(emails, sortedAnalysis);
          result.summary = this.generatePrioritySummary(emails, sortedAnalysis);
          break;

        default:
          // Default to 'full' - return full emails without analysis
          // Already set in result initialization
      }

      return result;
    } catch (error: any) {
      throw new Error(`Failed to find emails: ${error.message}`);
    }
  }

  private async buildSearchParamsFromIntent(searchIntent: any): Promise<any> {
    const params: any = {};
    
    // Apply filters from AI understanding
    if (searchIntent.filters) {
      if (searchIntent.filters.unread !== undefined) {
        params.unread = searchIntent.filters.unread;
      }
      if (searchIntent.filters.starred !== undefined) {
        params.starred = searchIntent.filters.starred;
      }
      if (searchIntent.filters.hasAttachments !== undefined) {
        params.hasAttachment = searchIntent.filters.hasAttachments;
      }
    }
    
    // Apply timeframe
    if (searchIntent.timeframe) {
      if (searchIntent.timeframe.start) {
        const startTime = searchIntent.timeframe.start.getTime();
        if (!isNaN(startTime)) {
          params.receivedAfter = Math.floor(startTime / 1000);
        }
      }
      if (searchIntent.timeframe.end) {
        const endTime = searchIntent.timeframe.end.getTime();
        if (!isNaN(endTime)) {
          params.receivedBefore = Math.floor(endTime / 1000);
        }
      }
    }
    
    // Build search query from AI understanding
    const searchParts: string[] = [];
    
    // Add senders
    if (searchIntent.senders && searchIntent.senders.length > 0) {
      searchIntent.senders.forEach((sender: string) => {
        searchParts.push(`from:${sender}`);
      });
    }
    
    // Add keywords
    if (searchIntent.keywords && searchIntent.keywords.length > 0) {
      searchParts.push(...searchIntent.keywords);
    }
    
    if (searchParts.length > 0) {
      params.searchQueryNative = searchParts.join(' ');
    }
    
    return params;
  }


  private async filterUnrepliedEmails(emails: Email[]): Promise<Email[]> {
    const unreplied: Email[] = [];
    
    for (const email of emails) {
      if (email.thread_id) {
        try {
          // Check if thread has replies from us
          const thread = await this.nylas.threads.find({
            identifier: this.grantId,
            threadId: email.thread_id
          });
          
          // Simple check: if thread has only one message, it's unreplied
          if (thread.data.messageIds && thread.data.messageIds.length === 1) {
            unreplied.push(email);
          }
        } catch (error) {
          console.error(`Failed to check thread ${email.thread_id}:`, error);
          // Include email if we can't check
          unreplied.push(email);
        }
      } else {
        // No thread means single email, likely unreplied
        unreplied.push(email);
      }
    }
    
    return unreplied;
  }

  private async extractAllActionItems(emails: Email[]): Promise<ActionItem[]> {
    const allActionItems: ActionItem[] = [];
    
    for (const email of emails) {
      try {
        const items = await this.emailAI.extractActionItems(email);
        allActionItems.push(...items);
      } catch (error) {
        console.error(`Failed to extract action items from email ${email.id}:`, error);
      }
    }

    return allActionItems;
  }

  private async generateBasicSummary(emails: Email[], query: string): Promise<string> {
    const count = emails.length;
    const unreadCount = emails.filter(e => e.unread).length;
    const starredCount = emails.filter(e => e.starred).length;

    let summary = `Found ${count} email${count !== 1 ? 's' : ''} matching "${query}"`;
    
    const details: string[] = [];
    if (unreadCount > 0) details.push(`${unreadCount} unread`);
    if (starredCount > 0) details.push(`${starredCount} starred`);
    
    if (details.length > 0) {
      summary += ` (${details.join(', ')})`;
    }
    
    summary += '.';

    // Add sender information
    if (emails.length > 0) {
      const senders = emails.slice(0, 3).map(e => 
        e.from[0]?.name || e.from[0]?.email?.split('@')[0] || 'Unknown'
      );
      summary += ` From: ${senders.join(', ')}`;
      if (emails.length > 3) {
        summary += ` and ${emails.length - 3} others`;
      }
      summary += '.';
    }

    return summary;
  }

  private generateDetailedSummary(emails: Email[], analysis: EmailAnalysis[]): string {
    const count = emails.length;
    const importantCount = analysis.filter(a => a.importance_score > 0.7).length;
    const actionRequired = analysis.filter(a => a.action_required).length;
    
    const categories = analysis.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    let summary = `Analyzed ${count} emails: `;
    summary += `${importantCount} important, `;
    summary += `${actionRequired} need action. `;
    summary += `By category: ${Object.entries(categories)
      .map(([cat, cnt]) => `${cat.replace('_', ' ')} (${cnt})`)
      .join(', ')}.`;

    return summary;
  }

  private generateActionSummary(emails: Email[], actionItems: ActionItem[]): string {
    const highPriority = actionItems.filter(a => a.priority === 'high').length;
    const withDeadlines = actionItems.filter(a => a.deadline).length;

    let summary = `Found ${emails.length} emails with ${actionItems.length} action items`;
    
    const details: string[] = [];
    if (highPriority > 0) details.push(`${highPriority} high priority`);
    if (withDeadlines > 0) details.push(`${withDeadlines} with deadlines`);
    
    if (details.length > 0) {
      summary += ` (${details.join(', ')})`;
    }
    summary += '.';

    return summary;
  }

  private generatePrioritySummary(emails: Email[], analysis: EmailAnalysis[]): string {
    const topPriority = analysis.slice(0, 3);
    const names = topPriority
      .map(a => {
        const email = emails.find(e => e.id === a.email_id);
        return email?.from[0]?.name || email?.from[0]?.email?.split('@')[0] || 'Unknown';
      })
      .join(', ');

    return `${emails.length} emails sorted by priority. Most important from: ${names}.`;
  }

  private sortEmailsByAnalysis(emails: Email[], analysis: EmailAnalysis[]): Email[] {
    const emailMap = new Map(emails.map(e => [e.id, e]));
    const sortedEmails: Email[] = [];

    // First add emails in order of analysis (already sorted by importance)
    for (const a of analysis) {
      const email = emailMap.get(a.email_id);
      if (email) {
        sortedEmails.push(email);
        emailMap.delete(a.email_id);
      }
    }

    // Add any remaining emails
    sortedEmails.push(...emailMap.values());

    return sortedEmails;
  }
}