import Nylas from 'nylas';
import { EmailAI } from '../ai/emailAI.js';
// ApprovalManager removed - using stateless approval flow
import { 
  ManageEmailParams, 
  Email, 
  EmailIntent,
  GeneratedEmail,
  ApprovalRequiredResponse 
} from '../types/index.js';

export class ManageEmailTool {
  private senderInfo: { email?: string; name?: string } | null = null;

  constructor(
    private nylas: Nylas,
    private grantId: string,
    private emailAI: EmailAI,
    private userContext?: { userName?: string; userEmail?: string }
  ) {
    // Initialize sender info from user context if available
    if (userContext?.userName || userContext?.userEmail) {
      this.senderInfo = {
        email: userContext.userEmail || 'sender@email.com',
        name: userContext.userName || (userContext.userEmail ? userContext.userEmail.split('@')[0] : 'Sender')
      };
      console.log('📧 Sender info from context:', this.senderInfo);
    }
  }

  async execute(params: ManageEmailParams): Promise<any> {
    // Check if this is an approved action execution
    if (params.approved && params.action_data) {
      return this.executeApprovedAction(params);
    }

    // Get sender info if not cached (skip if already set from context)
    if (!this.senderInfo) {
      await this.fetchSenderInfo();
    }

    // Process the natural language query
    const context = await this.getContext(params);
    const intent = await this.emailAI.understandQuery(params.query, context);

    // Generate email content based on intent
    const emailContent = await this.generateContent(intent, params, context);

    // Handle different actions
    switch (params.action) {
      case 'send':
      case 'reply':
      case 'forward':
        if (params.require_approval !== false) {
          return this.createStatelessApprovalRequest(emailContent, params, intent);
        } else {
          return this.sendEmail(emailContent);
        }
      
      case 'draft':
        return this.createDraft(emailContent);
      
      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  }

  private async getContext(params: ManageEmailParams): Promise<any> {
    if (params.action === 'reply' || params.action === 'forward') {
      let originalMessage: Email | null = null;

      if (params.context_message_id) {
        // Fetch the specific message
        const message = await this.nylas.messages.find({
          identifier: this.grantId,
          messageId: params.context_message_id
        });
        originalMessage = message.data as Email;
      } else if (params.action === 'reply') {
        // Try to find the most recent relevant message
        originalMessage = await this.findRelevantMessage(params.query);
      }

      if (originalMessage && params.action === 'reply') {
        return {
          senderEmail: originalMessage.from[0]?.email,
          originalMessage
        };
      } else if (originalMessage && params.action === 'forward') {
        return { originalMessage };
      }
    }

    return undefined;
  }

  private async findRelevantMessage(query: string): Promise<Email | null> {
    // Extract possible sender names from query
    const senderMatch = query.match(/(?:reply to|respond to)\s+(\w+)/i);
    if (!senderMatch) return null;

    const senderName = senderMatch[1];
    
    try {
      // Search for recent messages from this sender
      const messages = await this.nylas.messages.list({
        identifier: this.grantId,
        queryParams: {
          searchQueryNative: `from:${senderName}`,
          limit: 5
        }
      });

      if (messages.data.length > 0) {
        // Get full message details
        const fullMessage = await this.nylas.messages.find({
          identifier: this.grantId,
          messageId: messages.data[0].id
        });
        return fullMessage.data as Email;
      }
    } catch (error) {
      console.error('Error finding relevant message:', error);
    }

    return null;
  }

  private async lookupContactByEmail(email: string): Promise<string | null> {
    try {
      // Search for contacts with the specific email address
      const contacts = await this.nylas.contacts.list({
        identifier: this.grantId,
        queryParams: {
          email: email  // Use Nylas API's email search parameter
        }
      });

      if (contacts.data.length > 0) {
        const matchingContact = contacts.data[0];
        
        // Build full name from available parts
        const nameParts = [
          matchingContact.givenName,
          matchingContact.middleName,
          matchingContact.surname
        ].filter(Boolean);

        if (nameParts.length > 0) {
          return nameParts.join(' ');
        }

        // Fallback to nickname if no formal name parts
        if (matchingContact.nickname) {
          return matchingContact.nickname;
        }

        // Fallback to display name
        if (matchingContact.displayName && matchingContact.displayName !== email) {
          return matchingContact.displayName;
        }
      }

      // If not found in address book, try inbox source
      const inboxContacts = await this.nylas.contacts.list({
        identifier: this.grantId,
        queryParams: {
          email: email,
          source: 'inbox' as any  // Search contacts from email interactions
        }
      });

      if (inboxContacts.data.length > 0) {
        const contact = inboxContacts.data[0];
        if (contact.displayName && contact.displayName !== email) {
          return contact.displayName;
        }
      }
    } catch (error) {
      console.error('Error looking up contact:', error);
    }

    return null;
  }

  private async fetchSenderInfo(): Promise<void> {
    try {
      // Fetch grant information to get sender's email
      const grant = await this.nylas.grants.find({
        grantId: this.grantId
      });

      if (grant.data.email) {
        this.senderInfo = {
          email: grant.data.email,
          name: grant.data.email.split('@')[0] // Default to email prefix
        };

        // Try to get the actual name from contacts
        const senderName = await this.lookupContactByEmail(grant.data.email);
        if (senderName) {
          this.senderInfo.name = senderName;
        }
        
        console.log('📧 Sender info:', this.senderInfo);
      }
    } catch (error) {
      console.error('Error fetching sender info:', error);
      // Default sender info if we can't fetch it
      this.senderInfo = {
        email: 'sender@email.com',
        name: 'Sender'
      };
    }
  }

  private async generateContent(
    intent: EmailIntent,
    params: ManageEmailParams,
    context?: any
  ): Promise<GeneratedEmail> {
    const originalMessage = context?.originalMessage;
    
    // Lookup contact names for recipients
    const recipientNames: { [email: string]: string } = {};
    if (intent.recipients && intent.recipients.length > 0) {
      await Promise.all(
        intent.recipients.map(async (email) => {
          const contactName = await this.lookupContactByEmail(email);
          if (contactName) {
            recipientNames[email] = contactName;
          }
        })
      );
    }
    
    let generatedEmail = await this.emailAI.generateEmailContent(intent, originalMessage, recipientNames, this.senderInfo);

    // Add reply/forward specific handling
    if (params.action === 'reply' && originalMessage) {
      generatedEmail.in_reply_to = originalMessage.id;
      if (!generatedEmail.subject.startsWith('Re:')) {
        generatedEmail.subject = `Re: ${originalMessage.subject}`;
      }
    } else if (params.action === 'forward' && originalMessage) {
      if (!generatedEmail.subject.startsWith('Fwd:')) {
        generatedEmail.subject = `Fwd: ${originalMessage.subject}`;
      }
      // Append original message to body
      generatedEmail.body += `\n\n--- Original Message ---\n${originalMessage.body || originalMessage.snippet}`;
    }

    return generatedEmail;
  }

  private async createStatelessApprovalRequest(
    emailContent: GeneratedEmail,
    params: ManageEmailParams,
    intent: EmailIntent
  ): Promise<ApprovalRequiredResponse> {
    return {
      needs_approval: true,
      action_type: 'send_email',
      action_data: {
        email_content: emailContent,
        original_params: {
          action: params.action,
          query: params.query,
          context_message_id: params.context_message_id
        },
        intent: intent
      },
      preview: {
        summary: `${params.action.charAt(0).toUpperCase() + params.action.slice(1)} email to ${emailContent.to.join(', ')}`,
        details: {
          to: emailContent.to,
          cc: emailContent.cc,
          bcc: emailContent.bcc,
          subject: emailContent.subject,
          body: emailContent.body,
          action: params.action,
          tone: intent.tone,
          urgency: intent.urgency
        },
        risks: this.assessEmailRisks(emailContent, params)
      }
    };
  }

  private assessEmailRisks(emailContent: GeneratedEmail, params: ManageEmailParams): string[] {
    const risks: string[] = [];
    
    // Check for multiple recipients
    const totalRecipients = emailContent.to.length + 
      (emailContent.cc?.length || 0) + 
      (emailContent.bcc?.length || 0);
    
    if (totalRecipients > 5) {
      risks.push(`Sending to ${totalRecipients} recipients`);
    }
    
    // Check for external domains
    const internalDomain = process.env.INTERNAL_EMAIL_DOMAIN;
    if (internalDomain) {
      const externalRecipients = emailContent.to.filter(email => 
        !email.endsWith(`@${internalDomain}`)
      );
      if (externalRecipients.length > 0) {
        risks.push('Contains external recipients');
      }
    }
    
    // Check for reply-all scenarios
    if (params.action === 'reply' && totalRecipients > 2) {
      risks.push('Reply-all to multiple recipients');
    }
    
    return risks;
  }

  private async executeApprovedAction(params: ManageEmailParams): Promise<any> {
    if (!params.action_data?.email_content) {
      throw new Error('Missing email content in approved action');
    }
    
    const { email_content } = params.action_data;
    
    try {
      const result = await this.sendEmail(email_content);
      return {
        ...result,
        approval_executed: true
      };
    } catch (error: any) {
      throw new Error(`Failed to execute approved email action: ${error.message}`);
    }
  }

  // Legacy approval request method removed

  private async sendEmail(emailContent: GeneratedEmail): Promise<any> {
    try {
      // Simple HTML: just replace newlines with <br> tags
      const htmlBody = emailContent.body
        .replace(/\n\n/g, '<br><br>')  // Double newline = paragraph break
        .replace(/\n/g, '<br>');        // Single newline = line break
      
      const message = await this.nylas.messages.send({
        identifier: this.grantId,
        requestBody: {
          to: emailContent.to.map(email => ({ email })),
          cc: emailContent.cc?.map(email => ({ email })),
          bcc: emailContent.bcc?.map(email => ({ email })),
          subject: emailContent.subject,
          body: htmlBody,
          replyToMessageId: emailContent.in_reply_to
        }
      });

      return {
        success: true,
        message_id: message.data.id,
        message: 'Email sent successfully'
      };
    } catch (error: any) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  private async createDraft(emailContent: GeneratedEmail): Promise<any> {
    try {
      // Simple HTML: just replace newlines with <br> tags
      const htmlBody = emailContent.body
        .replace(/\n\n/g, '<br><br>')  // Double newline = paragraph break
        .replace(/\n/g, '<br>');        // Single newline = line break
      
      const draft = await this.nylas.drafts.create({
        identifier: this.grantId,
        requestBody: {
          to: emailContent.to.map(email => ({ email })),
          cc: emailContent.cc?.map(email => ({ email })),
          bcc: emailContent.bcc?.map(email => ({ email })),
          subject: emailContent.subject,
          body: htmlBody
        }
      });

      return {
        success: true,
        draft_id: draft.data.id,
        message: 'Draft created successfully'
      };
    } catch (error: any) {
      throw new Error(`Failed to create draft: ${error.message}`);
    }
  }
}