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

    try {
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
    } catch (error: any) {
      // Check if it's a contact resolution error
      if (error.message && error.message.includes('Could not find email addresses for:')) {
        // Return a user-friendly error response
        return {
          success: false,
          error: 'contact_not_found',
          message: error.message,
          suggestions: [
            'Use the full email address (e.g., sarah@example.com)',
            'Check if the contact exists in your address book',
            'Try a more specific name if multiple people share the same first name'
          ]
        };
      }
      
      // Re-throw other errors
      throw error;
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
      // First, try to find contacts with this name
      const contacts = await this.lookupContactsByName(senderName);
      
      if (contacts.length > 0) {
        // Search for messages from the resolved email addresses
        for (const contact of contacts) {
          const messages = await this.nylas.messages.list({
            identifier: this.grantId,
            queryParams: {
              from: [contact.email],
              limit: 5
            }
          });

          if (messages.data.length > 0) {
            // Get full message details
            const fullMessage = await this.nylas.messages.find({
              identifier: this.grantId,
              messageId: messages.data[0].id
            });
            console.log(`✅ Found message from ${contact.name} (${contact.email})`);
            return fullMessage.data as Email;
          }
        }
      }
      
      // Fallback: Try searching by name in the message content
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

  private async lookupContactsByName(name: string): Promise<Array<{ email: string; name: string }>> {
    const results: Array<{ email: string; name: string }> = [];
    const searchName = name.toLowerCase().trim();
    
    try {
      // Search in all three sources: address_book, domain, and inbox
      const sources = ['address_book', 'domain', 'inbox'] as const;
      
      for (const source of sources) {
        try {
          // Fetch contacts from each source with a reasonable limit
          const contacts = await this.nylas.contacts.list({
            identifier: this.grantId,
            queryParams: {
              source: source as any,
              limit: 100  // Reasonable limit to avoid too many API calls
            }
          });

          // Search through each contact's name fields
          for (const contact of contacts.data) {
            const emails = contact.emails || [];
            if (emails.length === 0) continue;

            // Build possible name variations to search
            const nameVariations: string[] = [];
            
            // Full name from parts
            const nameParts = [
              contact.givenName,
              contact.middleName,
              contact.surname
            ].filter(Boolean);
            if (nameParts.length > 0) {
              nameVariations.push(nameParts.join(' '));
            }
            
            // Individual name parts
            if (contact.givenName) nameVariations.push(contact.givenName);
            if (contact.surname) nameVariations.push(contact.surname);
            if (contact.nickname) nameVariations.push(contact.nickname);
            if (contact.displayName) nameVariations.push(contact.displayName);
            
            // Check if any name variation matches our search
            const matches = nameVariations.some(variation => 
              variation.toLowerCase().includes(searchName) ||
              searchName.includes(variation.toLowerCase())
            );
            
            if (matches) {
              // Get the best display name for this contact
              const displayName = contact.displayName || 
                                  (nameParts.length > 0 ? nameParts.join(' ') : null) ||
                                  contact.nickname ||
                                  contact.givenName ||
                                  emails[0].email;
              
              // Add all email addresses for this contact
              for (const email of emails) {
                if (email.email) {
                  results.push({
                    email: email.email,
                    name: displayName
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching contacts from source ${source}:`, error);
          // Continue with other sources even if one fails
        }
      }
      
      // Remove duplicates based on email
      const uniqueResults = Array.from(
        new Map(results.map(item => [item.email, item])).values()
      );
      
      return uniqueResults;
    } catch (error) {
      console.error('Error looking up contacts by name:', error);
      return [];
    }
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
    
    // First, resolve any name-based recipients to email addresses
    const resolvedRecipients: string[] = [];
    const unresolvedNames: string[] = [];
    
    if (intent.recipients && intent.recipients.length > 0) {
      for (const recipient of intent.recipients) {
        // Check if it looks like an email address (contains @)
        if (recipient.includes('@')) {
          resolvedRecipients.push(recipient);
        } else {
          // It's likely a name, try to resolve it
          const contacts = await this.lookupContactsByName(recipient);
          
          if (contacts.length === 0) {
            unresolvedNames.push(recipient);
          } else if (contacts.length === 1) {
            // Single match, use it
            resolvedRecipients.push(contacts[0].email);
            logger.info(`✅ Resolved "${recipient}" to ${contacts[0].email}`);
          } else {
            // Multiple matches, for now use the first one but log a warning
            // In a future enhancement, we could ask for clarification
            resolvedRecipients.push(contacts[0].email);
            logger.warn(`⚠️ Multiple contacts found for "${recipient}", using ${contacts[0].email}`);
            logger.warn('Other matches: ' + contacts.slice(1).map(c => `${c.name} (${c.email})`).join(', '));
          }
        }
      }
    }
    
    // If we couldn't resolve some names, throw an error
    if (unresolvedNames.length > 0) {
      throw new Error(`Could not find email addresses for: ${unresolvedNames.join(', ')}. Please use full email addresses or ensure the contacts exist in your address book.`);
    }
    
    // Update intent with resolved email addresses
    intent.recipients = resolvedRecipients;
    
    // Lookup contact names for recipients (to get proper display names)
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