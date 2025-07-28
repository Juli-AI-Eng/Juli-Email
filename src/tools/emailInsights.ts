import Nylas from 'nylas';
import { EmailAI } from '../ai/emailAI';
import { 
  EmailInsightsParams, 
  Email, 
  EmailAnalysis,
  ActionItem
} from '../types';

export class EmailInsightsTool {
  constructor(
    private nylas: Nylas,
    private grantId: string,
    private emailAI: EmailAI
  ) {}

  async execute(params: EmailInsightsParams): Promise<any> {
    try {
      // Use AI to understand what kind of insight the user wants
      const intent = await this.emailAI.understandInsightsQuery(params.query);
      
      // Execute the appropriate insight generation based on AI understanding
      switch (intent.insight_type) {
        case 'daily_summary':
          return this.generateDailySummary();
          
        case 'weekly_summary':
          return this.generateWeeklySummary();
          
        case 'important_items':
          return this.findImportantItems();
          
        case 'response_needed':
          return this.findResponseNeeded();
          
        case 'analytics':
          return this.generateAnalytics(intent.time_period || params.time_period || 'week');
          
        case 'relationships':
          return this.analyzeRelationships();
          
        default:
          // This shouldn't happen with proper AI understanding, but fallback to daily summary
          return this.generateDailySummary();
      }
    } catch (error: any) {
      throw new Error(`Failed to generate insights: ${error.message}`);
    }
  }

  private async generateDailySummary(): Promise<any> {
    // Get emails from today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const startTimestamp = Math.floor(todayStart.getTime() / 1000);

    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        receivedAfter: startTimestamp,
        limit: 100
      }
    });

    const emails = messages.data as Email[];
    
    if (emails.length === 0) {
      return {
        summary: "No emails received today. Your inbox is clear!",
        insights: {
          total_emails: 0,
          suggestions: ["Great time to focus on deep work", "Check your sent items if expecting replies"]
        }
      };
    }
    
    // Analyze importance
    let analysis: EmailAnalysis[] = [];
    try {
      if (emails.length > 0) {
        analysis = await this.emailAI.analyzeEmailImportance(emails);
      }
    } catch (error) {
      console.error('AI analysis failed:', error);
    }

    const unreadCount = emails.filter(e => e.unread).length;
    const importantEmails = analysis.filter(a => a.importance_score > 0.8);
    
    // Group by category
    const categories: Record<string, number> = {};
    analysis.forEach(a => {
      categories[a.category] = (categories[a.category] || 0) + 1;
    });

    // Generate AI-powered insights about the day's emails
    try {
      const insights = await this.emailAI.generateDailyInsights(emails, analysis);
      
      return {
        summary: insights.executive_summary,
        insights: {
          total_emails: emails.length,
          unread_count: unreadCount,
          key_highlights: insights.key_highlights,
          action_priorities: insights.action_priorities,
          communication_patterns: insights.patterns,
          important_emails: importantEmails.map(a => {
            const email = emails.find(e => e.id === a.email_id);
            return {
              id: a.email_id,
              subject: email?.subject,
              from: email?.from[0]?.email,
              reason: a.reason
            };
          }),
          categories,
          recommendations: insights.recommendations
        }
      };
    } catch (error) {
      console.error('AI insights generation failed:', error);
      // Fallback to basic summary
      const summary = `You received ${emails.length} emails today (${unreadCount} unread). ` +
        `${importantEmails.length} are marked as important. ` +
        `Categories: ${Object.entries(categories).map(([cat, count]) => `${cat}: ${count}`).join(', ')}.`;

      return {
        summary,
        insights: {
          total_emails: emails.length,
          unread_count: unreadCount,
          important_emails: importantEmails.map(a => {
            const email = emails.find(e => e.id === a.email_id);
            return {
              id: a.email_id,
              subject: email?.subject,
              from: email?.from[0]?.email,
              reason: a.reason
            };
          }),
          categories
        }
      };
    }
  }

  private async generateWeeklySummary(): Promise<any> {
    // Get emails from the past week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);
    const startTimestamp = Math.floor(weekAgo.getTime() / 1000);

    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        receivedAfter: startTimestamp,
        limit: 500
      }
    });

    const emails = messages.data as Email[];
    
    if (emails.length === 0) {
      return {
        summary: "No emails received this week. Enjoy the peace and quiet!",
        insights: {
          total_emails: 0,
          suggestions: ["Perfect time for strategic planning", "Consider reaching out to important contacts"]
        }
      };
    }
    
    // Analyze importance
    let analysis: EmailAnalysis[] = [];
    try {
      if (emails.length > 0) {
        // Analyze a sample for performance reasons
        const sampleSize = Math.min(emails.length, 100);
        const emailSample = emails.slice(0, sampleSize);
        analysis = await this.emailAI.analyzeEmailImportance(emailSample);
      }
    } catch (error) {
      console.error('AI analysis failed:', error);
    }

    // Group by day for trend analysis
    const emailsByDay: Record<string, Email[]> = {};
    emails.forEach(email => {
      const date = new Date(email.date * 1000);
      const dayKey = date.toLocaleDateString();
      if (!emailsByDay[dayKey]) {
        emailsByDay[dayKey] = [];
      }
      emailsByDay[dayKey].push(email);
    });

    const unreadCount = emails.filter(e => e.unread).length;
    const importantEmails = analysis.filter(a => a.importance_score > 0.8);
    
    // Group by category
    const categories: Record<string, number> = {};
    analysis.forEach(a => {
      categories[a.category] = (categories[a.category] || 0) + 1;
    });

    // Generate AI-powered weekly insights
    try {
      const insights = await this.emailAI.generateWeeklyInsights(emails, analysis, emailsByDay);
      
      return {
        summary: insights.executive_summary,
        insights: {
          total_emails: emails.length,
          daily_average: Math.round(emails.length / 7),
          unread_count: unreadCount,
          week_over_week_trend: insights.week_trend,
          key_themes: insights.key_themes,
          productivity_insights: insights.productivity_insights,
          important_conversations: insights.important_conversations,
          important_emails: importantEmails.map(a => {
            const email = emails.find(e => e.id === a.email_id);
            return {
              id: a.email_id,
              subject: email?.subject,
              from: email?.from[0]?.email,
              reason: a.reason
            };
          }),
          categories,
          recommendations: insights.recommendations
        }
      };
    } catch (error) {
      console.error('AI insights generation failed:', error);
      // Fallback to basic summary
      const summary = `You received ${emails.length} emails this week (avg ${Math.round(emails.length / 7)}/day, ${unreadCount} unread). ` +
        `${importantEmails.length} are marked as important. ` +
        `Categories: ${Object.entries(categories).map(([cat, count]) => `${cat}: ${count}`).join(', ')}.`;

      return {
        summary,
        insights: {
          total_emails: emails.length,
          daily_average: Math.round(emails.length / 7),
          unread_count: unreadCount,
          important_emails: importantEmails.map(a => {
            const email = emails.find(e => e.id === a.email_id);
            return {
              id: a.email_id,
              subject: email?.subject,
              from: email?.from[0]?.email,
              reason: a.reason
            };
          }),
          categories
        }
      };
    }
  }

  private async findImportantItems(): Promise<any> {
    // Get recent unread emails
    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        unread: true,
        limit: 50
      }
    });

    const emails = messages.data as Email[];
    
    if (emails.length === 0) {
      return {
        summary: 'No unread emails to analyze.',
        insights: {
          important_emails: [],
          action_items: []
        }
      };
    }

    // Analyze importance
    let analysis: EmailAnalysis[] = [];
    try {
      analysis = await this.emailAI.analyzeEmailImportance(emails);
    } catch (error) {
      console.error('AI analysis failed:', error);
      return {
        summary: 'Unable to analyze email importance at this time.',
        insights: {
          total_emails: emails.length,
          important_emails: []
        }
      };
    }

    // Generate AI-powered insights about important items
    try {
      const insights = await this.emailAI.generateImportantItemsInsights(emails, analysis);
      
      // Extract action items from important emails
      const actionItems: ActionItem[] = [];
      const importantAnalysis = analysis.filter(a => a.importance_score > 0.8);
      
      for (const a of importantAnalysis) {
        const email = emails.find(e => e.id === a.email_id);
        if (email && a.action_required) {
          try {
            const items = await this.emailAI.extractActionItems(email);
            actionItems.push(...items);
          } catch (error) {
            console.error('Failed to extract action items:', error);
          }
        }
      }

      return {
        summary: insights.executive_summary,
        insights: {
          priority_items: insights.priority_items,
          action_plan: insights.action_plan,
          key_deadlines: insights.key_deadlines,
          action_items: actionItems,
          total_analyzed: emails.length
        }
      };
    } catch (error) {
      console.error('AI insights generation failed:', error);
      // Fallback to basic summary
      const importantEmails = analysis
        .filter(a => a.importance_score > 0.8)
        .map(a => {
          const email = emails.find(e => e.id === a.email_id);
          return {
            id: a.email_id,
            subject: email?.subject,
            from: email?.from[0]?.email,
            reason: a.reason,
            action_required: a.action_required
          };
        });

      return {
        summary: `Found ${importantEmails.length} important emails that require attention.`,
        insights: {
          important_emails: importantEmails,
          action_items: []
        }
      };
    }
  }

  private async findResponseNeeded(): Promise<any> {
    // Get recent emails that might need responses
    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        limit: 50
      }
    });

    const emails = messages.data as Email[];
    
    // Filter emails that likely need responses
    const needsResponse: Email[] = [];
    
    for (const email of emails) {
      // Skip if from self or automated emails
      if (email.from[0]?.email?.includes('noreply') || 
          email.from[0]?.email?.includes('notification')) {
        continue;
      }

      // Check if email has been replied to
      if (email.thread_id) {
        try {
          const thread = await this.nylas.threads.find({
            identifier: this.grantId,
            threadId: email.thread_id
          });
          
          // If thread has only one message, it hasn't been replied to
          if (thread.data.messageIds && thread.data.messageIds.length === 1) {
            needsResponse.push(email);
          }
        } catch (error) {
          console.error('Failed to check thread:', error);
        }
      }
    }

    if (needsResponse.length === 0) {
      return {
        summary: 'No emails currently need responses.',
        insights: {
          response_priorities: [],
          response_strategy: [],
          time_estimate: '0 minutes'
        }
      };
    }

    // Generate AI-powered insights about response needs
    try {
      const insights = await this.emailAI.generateResponseNeededInsights(emails, needsResponse);
      
      return {
        summary: insights.executive_summary,
        insights: {
          response_priorities: insights.response_priorities,
          response_strategy: insights.response_strategy,
          time_estimate: insights.time_estimate,
          total_needing_response: needsResponse.length
        }
      };
    } catch (error) {
      console.error('AI insights generation failed:', error);
      // Fallback to basic summary
      let analysis: EmailAnalysis[] = [];
      if (needsResponse.length > 0) {
        try {
          analysis = await this.emailAI.analyzeEmailImportance(needsResponse);
        } catch (error) {
          console.error('AI analysis failed:', error);
        }
      }

      const responseEmails = needsResponse.map(email => {
        const a = analysis.find(an => an.email_id === email.id);
        return {
          id: email.id,
          subject: email.subject,
          from: email.from[0]?.email,
          importance_score: a?.importance_score || 0.5,
          reason: a?.reason || 'Needs response'
        };
      }).sort((a, b) => b.importance_score - a.importance_score);

      const summary = `${responseEmails.length} emails need responses. ` +
        `${responseEmails.filter(e => e.importance_score > 0.7).length} are high priority.`;

      return {
        summary,
        insights: {
          needs_response: responseEmails
        }
      };
    }
  }

  private async generateAnalytics(timePeriod: string): Promise<any> {
    // Calculate date range
    const now = new Date();
    let daysAgo = 7;
    
    switch (timePeriod) {
      case 'day':
        daysAgo = 1;
        break;
      case 'week':
        daysAgo = 7;
        break;
      case 'month':
        daysAgo = 30;
        break;
    }

    const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const startTimestamp = Math.floor(startDate.getTime() / 1000);

    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        receivedAfter: startTimestamp,
        limit: 500
      }
    });

    const emails = messages.data as Email[];

    if (emails.length === 0) {
      return {
        summary: `No emails found for the past ${timePeriod}.`,
        insights: {
          volume_analysis: {
            trend: 'No activity',
            pattern: 'No emails',
            anomalies: []
          }
        }
      };
    }

    // Calculate analytics
    const senderCounts = new Map<string, number>();
    emails.forEach(email => {
      const sender = email.from[0]?.email;
      if (sender) {
        senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
      }
    });

    // Categorize emails
    let categories: Record<string, number> = {};
    try {
      const categoryMap = await this.emailAI.categorizeEmails(emails.slice(0, 100));
      categoryMap.forEach((emailIds, category) => {
        categories[category] = emailIds.length;
      });
    } catch (error) {
      console.error('Categorization failed:', error);
    }

    // Generate AI-powered analytics insights
    try {
      const insights = await this.emailAI.generateAnalyticsInsights(
        emails,
        timePeriod,
        senderCounts,
        categories
      );

      return {
        summary: insights.executive_summary,
        insights: {
          volume_analysis: insights.volume_analysis,
          sender_insights: insights.sender_insights,
          productivity_metrics: insights.productivity_metrics,
          recommendations: insights.recommendations,
          raw_analytics: {
            total_emails: emails.length,
            emails_per_day: emails.length / daysAgo,
            unread_count: emails.filter(e => e.unread).length
          }
        }
      };
    } catch (error) {
      console.error('AI analytics generation failed:', error);
      // Fallback to basic analytics
      const topSenders = Array.from(senderCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sender]) => sender);

      const analytics = {
        total_emails: emails.length,
        emails_per_day: emails.length / daysAgo,
        top_senders: topSenders,
        categories: categories,
        unread_count: emails.filter(e => e.unread).length
      };

      const summary = `Email analytics for the past ${timePeriod}: ` +
        `${analytics.total_emails} total emails (${analytics.emails_per_day.toFixed(1)}/day). ` +
        `Top sender: ${topSenders[0] || 'None'}.`;

      return {
        summary,
        insights: {
          analytics
        }
      };
    }
  }

  private async analyzeRelationships(): Promise<any> {
    // Get emails from past month
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    
    const messages = await this.nylas.messages.list({
      identifier: this.grantId,
      queryParams: {
        receivedAfter: thirtyDaysAgo,
        limit: 500
      }
    });

    const emails = messages.data as Email[];

    if (emails.length === 0) {
      return {
        summary: 'No emails found to analyze relationships.',
        insights: {
          key_relationships: [],
          communication_patterns: {
            balance_analysis: 'No data available',
            response_patterns: [],
            collaboration_insights: []
          }
        }
      };
    }

    // Analyze communication patterns
    const contactStats = new Map<string, { sent: number; received: number; importance: number }>();
    
    // First, we need to identify the user's email
    const userEmail = emails.find(e => e.from[0]?.email)?.to?.[0]?.email || 'me@company.com';

    emails.forEach(email => {
      const isFromMe = email.from[0]?.email === userEmail;
      const contact = isFromMe ? email.to?.[0]?.email : email.from[0]?.email;
      
      if (contact) {
        const stats = contactStats.get(contact) || { sent: 0, received: 0, importance: 0 };
        if (isFromMe) {
          stats.sent++;
        } else {
          stats.received++;
        }
        contactStats.set(contact, stats);
      }
    });

    // Get importance scores for relationships
    try {
      const analysis = await this.emailAI.analyzeEmailImportance(emails.slice(0, 100));
      analysis.forEach(a => {
        const email = emails.find(e => e.id === a.email_id);
        const contact = email?.from[0]?.email;
        if (contact && contactStats.has(contact)) {
          const stats = contactStats.get(contact)!;
          stats.importance += a.importance_score;
          contactStats.set(contact, stats);
        }
      });
    } catch (error) {
      console.error('AI analysis failed:', error);
    }

    // Generate AI-powered relationship insights
    try {
      const insights = await this.emailAI.generateRelationshipInsights(emails, contactStats);

      return {
        summary: insights.executive_summary,
        insights: {
          key_relationships: insights.key_relationships,
          communication_patterns: insights.communication_patterns,
          network_insights: insights.network_insights,
          recommendations: insights.recommendations
        }
      };
    } catch (error) {
      console.error('AI relationship insights generation failed:', error);
      // Fallback to basic analysis
      const relationships = Array.from(contactStats.entries())
        .map(([contact, stats]) => ({
          contact,
          total_interactions: stats.sent + stats.received,
          balance: stats.sent / (stats.received || 1),
          avg_importance: stats.importance / (stats.received || 1)
        }))
        .sort((a, b) => b.total_interactions - a.total_interactions)
        .slice(0, 10);

      const frequentContacts = relationships.slice(0, 5).map(r => r.contact);
      const communicationBalance = relationships.reduce((acc, r) => {
        if (r.balance > 2) return { ...acc, over_communicating: acc.over_communicating + 1 };
        if (r.balance < 0.5) return { ...acc, under_communicating: acc.under_communicating + 1 };
        return { ...acc, balanced: acc.balanced + 1 };
      }, { over_communicating: 0, under_communicating: 0, balanced: 0 });

      const summary = `Analyzed communication patterns with ${contactStats.size} contacts. ` +
        `Most frequent: ${frequentContacts[0] || 'None'}.`;

      return {
        summary,
        insights: {
          relationships: {
            frequent_contacts: frequentContacts,
            communication_balance: communicationBalance,
            top_relationships: relationships.slice(0, 5)
          }
        }
      };
    }
  }
}