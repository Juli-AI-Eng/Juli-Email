import OpenAI from 'openai';
import {
  EmailIntent,
  GeneratedEmail,
  EmailAnalysis,
  ActionItem,
  Email
} from '../types';

export class EmailAI {
  private openai: OpenAI;
  private debugMode: boolean;
  private defaultReasoningEffort: 'minimal' | 'low' | 'medium' | 'high';
  private defaultVerbosity: 'low' | 'medium' | 'high';

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for EmailAI');
    }

    this.openai = new OpenAI({
      apiKey: apiKey
    });

    // Enable debug mode for tests
    this.debugMode = process.env.NODE_ENV === 'test' || process.env.DEBUG_AI === 'true';

    // Defaults optimized for latency unless overridden via env
    const reasoning = (process.env.OPENAI_REASONING_EFFORT || 'minimal').toLowerCase();
    const verbosity = (process.env.OPENAI_VERBOSITY || 'low').toLowerCase();
    this.defaultReasoningEffort = (['minimal', 'low', 'medium', 'high'].includes(reasoning) ? reasoning : 'minimal') as any;
    this.defaultVerbosity = (['low', 'medium', 'high'].includes(verbosity) ? verbosity : 'low') as any;
  }

  private buildGpt5Params(overrides?: { reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high'; verbosity?: 'low' | 'medium' | 'high' }) {
    return {
      reasoning: { effort: overrides?.reasoning_effort || this.defaultReasoningEffort },
      text: { verbosity: overrides?.verbosity || this.defaultVerbosity }
    } as any;
  }

  private extractFirstToolCall(response: any): { name: string; arguments: string } | null {
    if (!response) return null;
    const out = (response as any).output;
    if (Array.isArray(out)) {
      // Direct tool/function call items (Responses API emits type 'function_call')
      const tc = out.find((o: any) => o?.type === 'tool_call' || o?.type === 'function_call');
      if (tc) {
        const name = tc.tool_name || tc.name;
        const args = tc.arguments || tc.arguments_text || (typeof tc.input === 'object' ? JSON.stringify(tc.input) : tc.input);
        if (name && args !== undefined) return { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
      }
      // Tool use embedded in message content
      const msg = out.find((o: any) => o?.type === 'message');
      const content = msg?.content;
      if (Array.isArray(content)) {
        const toolUse = content.find((c: any) => c?.type === 'tool_use' && c?.name);
        if (toolUse) {
          const args = toolUse.input ?? {};
          return { name: toolUse.name, arguments: JSON.stringify(args) };
        }
      }
    }
    return null;
  }

  private extractText(response: any): string | undefined {
    if (!response) return undefined;
    if (typeof response.output_text === 'string') return response.output_text as string;
    const out = (response as any).output;
    if (Array.isArray(out)) {
      const msg = out.find((o: any) => o?.type === 'message');
      const parts = msg?.content;
      if (Array.isArray(parts)) {
        const texts = parts.filter((p: any) => p?.type === 'output_text' || p?.type === 'text').map((p: any) => p?.text || p?.content).filter(Boolean);
        if (texts.length > 0) return texts.join('\n');
      }
    }
    return undefined;
  }

  async understandSearchQuery(query: string): Promise<{
    intent: string;
    timeframe?: { start?: Date; end?: Date };
    senders?: string[];
    keywords?: string[];
    filters?: {
      unread?: boolean;
      starred?: boolean;
      hasAttachments?: boolean;
    };
  }> {
    const tools = [{
      type: "function" as const,
      name: "extract_search_params",
      description: "Extract email search parameters from natural language query",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "The search intent"
          },
          timeframe: {
            type: ["object", "null"],
            properties: {
              start: {
                type: ["string", "null"],
                description: "Start date/time (e.g., '2024-01-01', 'yesterday', '7 days ago')"
              },
              end: {
                type: ["string", "null"],
                description: "End date/time"
              }
            },
            required: ["start", "end"],
            additionalProperties: false,
            description: "Time range for the search"
          },
          senders: {
            type: ["array", "null"],
            items: {
              type: "string",
              description: "Sender name or email"
            },
            description: "List of senders to filter by"
          },
          keywords: {
            type: ["array", "null"],
            items: {
              type: "string",
              description: "Keyword to search for"
            },
            description: "Keywords to search in email content"
          },
          filters: {
            type: ["object", "null"],
            properties: {
              unread: {
                type: ["boolean", "null"],
                description: "Filter for unread emails"
              },
              starred: {
                type: ["boolean", "null"],
                description: "Filter for starred/important emails"
              },
              hasAttachments: {
                type: ["boolean", "null"],
                description: "Filter for emails with attachments"
              }
            },
            required: ["unread", "starred", "hasAttachments"],
            additionalProperties: false,
            description: "Boolean filters for email properties"
          }
        },
        required: ["intent", "timeframe", "senders", "keywords", "filters"],
        additionalProperties: false
      }
    }];

    const systemPrompt = `You are an email search assistant. Analyze the user's natural language query and extract structured search parameters.
    
Examples:
- "emails from John about the project" → senders: ["John"], keywords: ["project"]
- "unread emails from last week" → filters: { unread: true }, timeframe: { start: "7 days ago" }
- "important emails I haven't responded to" → filters: { starred: true }
- "emails with attachments from yesterday" → filters: { hasAttachments: true }, timeframe: { start: "yesterday", end: "today" }`;

    if (this.debugMode) {
      console.log('\n🤖 AI Search Query Understanding');
      console.log('📝 User Query:', query);
      console.log('🔧 Function Schema:', JSON.stringify((tools as any)[0].parameters, null, 2));
    }

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "extract_search_params" },
      ...this.buildGpt5Params()
    });

    if (this.debugMode) {
      console.log('📊 AI Response:', JSON.stringify(completion.choices[0].message, null, 2));
    }

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'extract_search_params') {
      throw new Error('Failed to understand search query');
    }

    const result = JSON.parse((toolCall as any).arguments || (toolCall as any).function?.arguments);

    // Clean up null values and parse dates if needed
    const searchParams: any = {
      intent: result.intent
    };

    if (result.timeframe && (result.timeframe.start || result.timeframe.end)) {
      searchParams.timeframe = {};
      if (result.timeframe.start) {
        searchParams.timeframe.start = this.parseTimeString(result.timeframe.start);
      }
      if (result.timeframe.end) {
        searchParams.timeframe.end = this.parseTimeString(result.timeframe.end);
      }
    }

    if (result.senders && result.senders.length > 0) {
      searchParams.senders = result.senders;
    }

    if (result.keywords && result.keywords.length > 0) {
      searchParams.keywords = result.keywords;
    }

    if (result.filters) {
      searchParams.filters = {};
      if (result.filters.unread !== null) searchParams.filters.unread = result.filters.unread;
      if (result.filters.starred !== null) searchParams.filters.starred = result.filters.starred;
      if (result.filters.hasAttachments !== null) searchParams.filters.hasAttachments = result.filters.hasAttachments;
    }

    return searchParams;
  }

  private parseTimeString(timeStr: string): Date {
    const now = new Date();
    const lowerStr = timeStr.toLowerCase();

    // Handle relative dates
    if (lowerStr === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (lowerStr === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    } else if (lowerStr.includes('days ago')) {
      const days = parseInt(lowerStr.match(/(\d+)\s*days?\s*ago/)?.[1] || '0');
      const date = new Date(now);
      date.setDate(date.getDate() - days);
      return date;
    } else if (lowerStr.includes('hours ago')) {
      const hours = parseInt(lowerStr.match(/(\d+)\s*hours?\s*ago/)?.[1] || '0');
      const date = new Date(now);
      date.setHours(date.getHours() - hours);
      return date;
    } else if (lowerStr === 'last week') {
      const date = new Date(now);
      date.setDate(date.getDate() - 7);
      return date;
    } else if (lowerStr === 'last month') {
      const date = new Date(now);
      date.setMonth(date.getMonth() - 1);
      return date;
    }

    // Try to parse as a date string
    return new Date(timeStr);
  }

  async understandQuery(query: string, context?: any): Promise<EmailIntent> {
    const tools = [{
      type: "function" as const,
      name: "extract_email_intent",
      description: "Extract the intent, recipients, subject, key points, urgency and tone from a natural language email request",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: ["send", "reply", "forward", "find", "organize"],
            description: "The user's intent"
          },
          recipients: {
            type: "array",
            items: {
              type: "string",
              description: "Email address or contact name (e.g., 'john@example.com' or 'Sarah')"
            },
            description: "List of recipient email addresses or contact names to be resolved"
          },
          subject: {
            type: "string",
            description: "Suggested email subject line"
          },
          key_points: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Key points or topics to include"
          },
          urgency: {
            type: "string",
            enum: ["low", "normal", "high", "urgent"],
            description: "Urgency level of the email"
          },
          tone: {
            type: "string",
            enum: ["professional", "casual", "friendly", "formal", "grateful"],
            description: "Desired tone of the email"
          }
        },
        required: ["intent", "recipients", "subject", "key_points", "urgency", "tone"],
        additionalProperties: false
      }
    }];

    const systemPrompt = `You are an email assistant. Analyze the user's request and extract email intent information.
    
    IMPORTANT: Recipients can be specified as either:
    - Full email addresses (e.g., "john@example.com")
    - Contact names (e.g., "Sarah", "John Smith") which will be resolved later
    
    When the user mentions people by name only (like "email Sarah"), extract the name as-is in the recipients array.
    ${context?.senderEmail ? `Context: The user wants to reply to an email from ${context.senderEmail}` : ''}`;

    if (this.debugMode) {
      console.log('\n🤖 AI Email Intent Understanding');
      console.log('📝 User Query:', query);
      console.log('🔧 Function Schema:', JSON.stringify((tools as any)[0].parameters, null, 2));
    }

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "extract_email_intent" },
      ...this.buildGpt5Params()
    });

    if (this.debugMode) {
      try {
        console.log('🧪 Responses output (understandQuery):', JSON.stringify(completion, null, 2));
      } catch { }
    }

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'extract_email_intent') {
      throw new Error('Failed to extract email intent');
    }
    const result = JSON.parse(toolCall.arguments) as EmailIntent;

    // If context has sender email and intent is reply, ensure it's in recipients
    if (context?.senderEmail && result.intent === 'reply') {
      result.recipients = result.recipients || [];
      if (!result.recipients.includes(context.senderEmail)) {
        result.recipients.push(context.senderEmail);
      }
    }

    return result;
  }

  async generateEmailContent(intent: EmailIntent, contextEmail?: Email, recipientNames?: { [email: string]: string }, senderInfo?: { email?: string; name?: string } | null): Promise<GeneratedEmail> {
    const tools = [{
      type: "function" as const,
      name: "generate_email",
      description: "Generate a complete email with recipients, subject, and body",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "array",
            items: {
              type: "string",
              description: "Recipient email address"
            },
            description: "Primary recipients"
          },
          cc: {
            type: ["array", "null"],
            items: {
              type: "string",
              description: "CC recipient email address"
            },
            description: "CC recipients"
          },
          bcc: {
            type: ["array", "null"],
            items: {
              type: "string",
              description: "BCC recipient email address"
            },
            description: "BCC recipients"
          },
          subject: {
            type: "string",
            description: "Email subject line"
          },
          body: {
            type: "string",
            description: "Complete email body"
          },
          tone_confirmation: {
            type: ["string", "null"],
            description: "Confirmation of tone used"
          }
        },
        required: ["to", "subject", "body", "cc", "bcc", "tone_confirmation"],
        additionalProperties: false
      }
    }];

    // Build recipient context with names when available
    const recipientContext = intent.recipients?.map(email => {
      const name = recipientNames?.[email];
      return name ? `${name} (${email})` : email;
    }).join(', ') || 'to be determined';

    const senderContext = senderInfo?.name && senderInfo?.email
      ? `You are writing this email as ${senderInfo.name} (${senderInfo.email})`
      : 'You are writing a professional email';

    const systemPrompt = `You are a professional email writer. ${senderContext}
    
    Generate an email based on:
    - Recipients: ${recipientContext}
    - Subject suggestion: ${intent.subject || 'Create appropriate subject'}
    - Key points to cover: ${intent.key_points.join(', ')}
    - Tone: ${intent.tone}
    - Urgency: ${intent.urgency}
    
    ${contextEmail ? `This is in response to an email with subject: "${contextEmail.subject}"` : ''}
    
    RECIPIENT NAMES: ${recipientNames && Object.keys(recipientNames).length > 0
        ? Object.entries(recipientNames).map(([email, name]) => `${email} = ${name}`).join(', ')
        : 'No contact names found - use "Hello" as greeting'}
    
    FORMATTING REQUIREMENTS:
    - Use proper paragraph breaks with double line breaks (\\n\\n) between paragraphs
    - Start with an appropriate greeting: If recipient name is known, use "Dear [Name]", otherwise use "Hello"
    - Structure: Greeting\n\nOpening paragraph\n\nBody paragraphs (if needed)\n\nClosing paragraph\n\nSign-off
    - Ensure professional spacing and readability
    - Each distinct thought or topic should be its own paragraph
    - End with an appropriate sign-off (Best regards, Sincerely, etc.) followed by the sender's name: ${senderInfo?.name || '[Your Name]'}
    
    Write a complete, professional email that covers all key points naturally with proper formatting.`;

    if (this.debugMode) {
      try {
        console.log('🔧 Tools (generateEmailContent):', JSON.stringify(tools));
      } catch { }
    }

    let completion: any;
    try {
      completion = await (this.openai as any).responses.create({
        model: "gpt-5",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the email content." }
        ],
        tools: tools,
        tool_choice: { type: "function", name: "generate_email" },
        ...this.buildGpt5Params({ verbosity: 'medium' })
      });
    } catch (err: any) {
      if (this.debugMode) {
        console.error('❌ OpenAI error (generateEmailContent):', err?.response?.data || err?.message || err);
      }
      throw err;
    }

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_email') {
      throw new Error('Failed to generate email content');
    }

    const result = JSON.parse(toolCall.arguments);

    // Debug log to see what the AI generated
    if (this.debugMode) {
      console.log('📧 Generated email body:', result.body);
      console.log('📧 Body includes \\n\\n:', result.body.includes('\\n\\n'));
    }

    // Convert null values to undefined for optional fields
    return {
      to: result.to,
      cc: result.cc || undefined,
      bcc: result.bcc || undefined,
      subject: result.subject,
      body: result.body,
      tone_confirmation: result.tone_confirmation || undefined
    };
  }

  async analyzeEmailImportance(emails: Email[]): Promise<EmailAnalysis[]> {
    const tools = [{
      type: "function" as const,
      name: "analyze_emails",
      description: "Analyze importance and categorize multiple emails",
      parameters: {
        type: "object",
        properties: {
          analyses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                email_id: {
                  type: "string",
                  description: "ID of the email being analyzed"
                },
                importance_score: {
                  type: "number",
                  description: "Importance score from 0 to 1"
                },
                category: {
                  type: "string",
                  enum: ["urgent_alert", "client_email", "newsletter", "notification", "personal", "other"],
                  description: "Email category"
                },
                reason: {
                  type: "string",
                  description: "Reason for the importance rating"
                },
                action_required: {
                  type: "boolean",
                  description: "Whether action is required"
                },
                suggested_folder: {
                  type: ["string", "null"],
                  description: "Suggested folder for organization"
                }
              },
              required: ["email_id", "importance_score", "category", "reason", "action_required", "suggested_folder"],
              additionalProperties: false
            },
            description: "Analysis results for each email"
          }
        },
        required: ["analyses"],
        additionalProperties: false
      }
    }];

    const emailSummaries = emails.map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from[0]?.email || 'unknown',
      snippet: e.snippet || ''
    }));

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: `Analyze emails for importance and categorization. Consider sender importance, urgency indicators, business impact, and time sensitivity.` },
        { role: "user", content: `Analyze these emails: ${JSON.stringify(emailSummaries)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "analyze_emails" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'analyze_emails') {
      throw new Error('Failed to analyze emails');
    }

    const result = JSON.parse(toolCall.arguments);
    return result.analyses.map((analysis: any) => ({
      ...analysis,
      suggested_folder: analysis.suggested_folder || undefined
    }));
  }

  async generateAggregatedSummary(emails: Email[]): Promise<string> {
    const tools = [{
      type: "function" as const,
      name: "generate_summary",
      description: "Generate a natural language summary of multiple emails",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "A comprehensive natural language summary of the emails"
          },
          key_topics: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Main topics discussed across the emails"
          },
          important_items: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Important items that need attention"
          },
          action_required: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Actions that need to be taken"
          }
        },
        required: ["summary", "key_topics", "important_items", "action_required"],
        additionalProperties: false
      }
    }];

    const emailSummaries = emails.map(e => ({
      subject: e.subject,
      from: e.from[0]?.name || e.from[0]?.email || 'unknown',
      snippet: e.snippet || '',
      date: e.date ? new Date(e.date * 1000).toLocaleString() : 'unknown'
    }));

    const systemPrompt = `You are an email assistant. Analyze these emails and provide a natural language summary that captures:
    1. The overall themes and topics
    2. What's important or urgent
    3. What actions the user needs to take
    4. Any patterns or trends
    
    Write the summary as if you're a helpful assistant briefing someone about their inbox.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Summarize these emails: ${JSON.stringify(emailSummaries)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_summary" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_summary') {
      throw new Error('Failed to generate summary');
    }

    const result = JSON.parse(toolCall.arguments);

    // Combine the structured data into a natural summary
    let fullSummary = result.summary;

    if (result.important_items.length > 0) {
      fullSummary += ` Important: ${result.important_items.join(', ')}.`;
    }

    if (result.action_required.length > 0) {
      fullSummary += ` Action needed: ${result.action_required.join(', ')}.`;
    }

    return fullSummary;
  }

  async extractActionItems(email: Email): Promise<ActionItem[]> {
    const tools = [{
      type: "function" as const,
      name: "extract_action_items",
      description: "Extract action items from an email",
      parameters: {
        type: "object",
        properties: {
          action_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task: {
                  type: "string",
                  description: "The action item or task"
                },
                deadline: {
                  type: ["string", "null"],
                  description: "Deadline if mentioned"
                },
                priority: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                  description: "Priority level"
                }
              },
              required: ["task", "deadline", "priority"],
              additionalProperties: false
            },
            description: "List of action items found"
          }
        },
        required: ["action_items"],
        additionalProperties: false
      }
    }];

    const emailContent = {
      subject: email.subject,
      from: email.from[0]?.email || 'unknown',
      body: email.body || email.snippet || ''
    };

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: "Extract all actionable items from the email. Be thorough." },
        { role: "user", content: `Extract action items from: ${JSON.stringify(emailContent)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "extract_action_items" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'extract_action_items') {
      throw new Error('Failed to extract action items');
    }

    const result = JSON.parse(toolCall.arguments);
    return result.action_items.map((item: any) => ({
      ...item,
      deadline: item.deadline || undefined
    }));
  }

  async generateSmartFolderRules(folderDescription: string): Promise<{
    name: string;
    rules: string[];
    description: string;
  }> {
    const tools = [{
      type: "function" as const,
      name: "generate_folder_rules",
      description: "Generate smart folder rules based on description",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Folder name"
          },
          rules: {
            type: "array",
            items: {
              type: "string",
              description: "A folder rule"
            },
            description: "List of rules for the folder"
          },
          description: {
            type: "string",
            description: "Folder description"
          }
        },
        required: ["name", "rules", "description"],
        additionalProperties: false
      }
    }];

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: "Generate smart folder rules based on the user description." },
        { role: "user", content: folderDescription }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_folder_rules" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_folder_rules') {
      throw new Error('Failed to generate folder rules');
    }

    return JSON.parse(toolCall.arguments);
  }

  async categorizeEmails(emails: Email[]): Promise<Map<string, string[]>> {
    const tools = [{
      type: "function" as const,
      name: "categorize_emails",
      description: "Categorize emails into logical groups",
      parameters: {
        type: "object",
        properties: {
          categories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                email_id: {
                  type: "string",
                  description: "Email ID"
                },
                category: {
                  type: "string",
                  description: "Category name"
                }
              },
              required: ["email_id", "category"],
              additionalProperties: false
            },
            description: "Email categorizations"
          }
        },
        required: ["categories"],
        additionalProperties: false
      }
    }];

    const emailSummaries = emails.map(e => ({
      id: e.id,
      subject: e.subject,
      from: e.from[0]?.email || 'unknown',
      snippet: e.snippet || ''
    }));

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: "Categorize emails into logical groups like: receipts, newsletters, work, personal, etc." },
        { role: "user", content: JSON.stringify(emailSummaries) }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "categorize_emails" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'categorize_emails') {
      throw new Error('Failed to categorize emails');
    }

    const result = JSON.parse(toolCall.arguments);

    // Group by category
    const categoryMap = new Map<string, string[]>();
    result.categories.forEach(({ email_id, category }: { email_id: string; category: string }) => {
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(email_id);
    });

    return categoryMap;
  }

  async understandOrganizationIntent(query: string): Promise<{
    rules: Array<{
      condition: string;
      action: string;
      target: string | null;
    }>;
  }> {
    const tools = [{
      type: "function" as const,
      name: "understand_organization",
      description: "Understand email organization intent from natural language",
      parameters: {
        type: "object",
        properties: {
          rules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                condition: {
                  type: "string",
                  description: "The condition to match emails (e.g., 'subject contains invoice', 'from newsletter@')"
                },
                action: {
                  type: "string",
                  description: "The action to take (e.g., 'move to folder', 'star', 'mark read')"
                },
                target: {
                  type: ["string", "null"],
                  description: "The target for the action (e.g., folder name, null for star/mark actions)"
                }
              },
              required: ["condition", "action", "target"],
              additionalProperties: false
            },
            description: "List of organization rules"
          }
        },
        required: ["rules"],
        additionalProperties: false
      }
    }];

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: "You are an email assistant that understands organization intents. Convert natural language into email organization rules." },
        { role: "user", content: query }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "understand_organization" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || !toolCall.arguments) {
      throw new Error('Failed to understand organization intent');
    }

    const result = JSON.parse(toolCall.arguments);
    return {
      rules: result.rules.map((rule: any) => ({
        condition: rule.condition,
        action: rule.action,
        target: rule.target || null
      }))
    };
  }

  async generateDailyInsights(emails: Email[], analysis: EmailAnalysis[]): Promise<{
    executive_summary: string;
    key_highlights: string[];
    action_priorities: string[];
    patterns: string[];
    recommendations: string[];
  }> {
    const tools = [{
      type: "function" as const,
      name: "generate_daily_insights",
      description: "Generate actionable insights from daily email activity",
      parameters: {
        type: "object",
        properties: {
          executive_summary: {
            type: "string",
            description: "A concise executive summary of the day's email activity with actionable insights"
          },
          key_highlights: {
            type: "array",
            items: {
              type: "string"
            },
            description: "3-5 key highlights from today's emails"
          },
          action_priorities: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Prioritized list of actions the user should take"
          },
          patterns: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Communication patterns or trends observed"
          },
          recommendations: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Strategic recommendations for email management"
          }
        },
        required: ["executive_summary", "key_highlights", "action_priorities", "patterns", "recommendations"],
        additionalProperties: false
      }
    }];

    const emailSummaries = emails.map(e => ({
      subject: e.subject,
      from: e.from[0]?.name || e.from[0]?.email || 'unknown',
      snippet: e.snippet || '',
      unread: e.unread,
      importance: analysis.find(a => a.email_id === e.id)?.importance_score || 0.5
    }));

    const systemPrompt = `You are an executive email assistant providing daily insights. Analyze the day's emails and provide:
    1. An executive summary that highlights what matters most
    2. Key highlights that need attention
    3. Prioritized actions the user should take
    4. Communication patterns (who's reaching out, about what)
    5. Strategic recommendations for better email management
    
    Focus on actionable insights, not just statistics. Help the user understand what's important and what to do about it.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these emails from today: ${JSON.stringify(emailSummaries.slice(0, 50))}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_daily_insights" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_daily_insights') {
      throw new Error('Failed to generate daily insights');
    }

    return JSON.parse(toolCall.arguments);
  }

  async understandInsightsQuery(query: string): Promise<{
    insight_type: 'daily_summary' | 'weekly_summary' | 'important_items' | 'response_needed' | 'analytics' | 'relationships';
    time_period?: string;
    focus_area?: string;
  }> {
    const tools = [{
      type: "function" as const,
      name: "understand_insights_request",
      description: "Understand what kind of email insights the user wants",
      parameters: {
        type: "object",
        properties: {
          insight_type: {
            type: "string",
            enum: ["daily_summary", "weekly_summary", "important_items", "response_needed", "analytics", "relationships"],
            description: "The type of insight requested"
          },
          time_period: {
            type: ["string", "null"],
            description: "Time period for the insights (e.g., 'today', 'this week', 'last month')"
          },
          focus_area: {
            type: ["string", "null"],
            description: "Specific area to focus on (e.g., 'project X', 'client emails')"
          }
        },
        required: ["insight_type", "time_period", "focus_area"],
        additionalProperties: false
      }
    }];

    const systemPrompt = `You are an email insights assistant. Analyze the user's request and determine what kind of email insights they want.
    
Examples:
- "summarize my emails today" → daily_summary
- "what emails need my response?" → response_needed
- "show me email analytics for this week" → analytics, time_period: "this week"
- "who am I communicating with most?" → relationships
- "what important emails did I get this week?" → important_items, time_period: "this week"
- "weekly summary" → weekly_summary`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "understand_insights_request" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'understand_insights_request') {
      throw new Error('Failed to understand insights request');
    }

    const result = JSON.parse(toolCall.arguments);
    return {
      insight_type: result.insight_type,
      time_period: result.time_period || undefined,
      focus_area: result.focus_area || undefined
    };
  }

  async generateWeeklyInsights(emails: Email[], analysis: EmailAnalysis[], emailsByDay: Record<string, Email[]>): Promise<{
    executive_summary: string;
    week_trend: string;
    key_themes: string[];
    productivity_insights: string[];
    important_conversations: string[];
    recommendations: string[];
  }> {
    const tools = [{
      type: "function" as const,
      function: {
        name: "generate_weekly_insights",
        description: "Generate comprehensive weekly email insights with trends and patterns",
        parameters: {
          type: "object",
          properties: {
            executive_summary: {
              type: "string",
              description: "A comprehensive executive summary of the week's email activity"
            },
            week_trend: {
              type: "string",
              description: "Description of how this week compared to typical patterns"
            },
            key_themes: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Main themes and topics from the week's emails"
            },
            productivity_insights: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Insights about email patterns and productivity"
            },
            important_conversations: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Key conversations and threads from the week"
            },
            recommendations: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Actionable recommendations for the upcoming week"
            }
          },
          required: ["executive_summary", "week_trend", "key_themes", "productivity_insights", "important_conversations", "recommendations"],
          additionalProperties: false
        },
        strict: true
      }
    }];

    // Prepare data for AI analysis
    const dailyVolumes = Object.entries(emailsByDay).map(([day, emails]) => ({
      day,
      count: emails.length,
      unread: emails.filter(e => e.unread).length
    }));

    const emailSummaries = emails.slice(0, 100).map(e => ({
      subject: e.subject,
      from: e.from[0]?.name || e.from[0]?.email || 'unknown',
      date: new Date(e.date * 1000).toLocaleDateString(),
      unread: e.unread,
      importance: analysis.find(a => a.email_id === e.id)?.importance_score || 0.5
    }));

    const systemPrompt = `You are an executive email assistant providing weekly insights. Analyze the week's email activity and provide:
    1. An executive summary highlighting major themes, important items, and overall email health
    2. Week-over-week trends (busier/quieter than usual, unusual patterns)
    3. Key themes and topics that dominated the week
    4. Productivity insights (response patterns, email overload indicators, time management)
    5. Important conversations that need follow-up
    6. Strategic recommendations for the upcoming week
    
    Daily volumes: ${JSON.stringify(dailyVolumes)}
    Total emails: ${emails.length}
    Unread: ${emails.filter(e => e.unread).length}
    
    Focus on actionable insights and patterns that help improve email management.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these emails from the past week: ${JSON.stringify(emailSummaries)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_weekly_insights" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_weekly_insights') {
      throw new Error('Failed to generate weekly insights');
    }

    return JSON.parse(toolCall.arguments);
  }

  async generateImportantItemsInsights(emails: Email[], analysis: EmailAnalysis[]): Promise<{
    executive_summary: string;
    priority_items: Array<{
      email_id: string;
      subject: string;
      from: string;
      importance_reason: string;
      action_required: string;
    }>;
    action_plan: string[];
    key_deadlines: string[];
  }> {
    const tools = [{
      type: "function" as const,
      function: {
        name: "generate_important_items",
        description: "Generate insights about important emails requiring attention",
        parameters: {
          type: "object",
          properties: {
            executive_summary: {
              type: "string",
              description: "A concise summary of what important items need attention"
            },
            priority_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  email_id: {
                    type: "string",
                    description: "ID of the important email"
                  },
                  subject: {
                    type: "string",
                    description: "Email subject"
                  },
                  from: {
                    type: "string",
                    description: "Sender name or email"
                  },
                  importance_reason: {
                    type: "string",
                    description: "Why this email is important"
                  },
                  action_required: {
                    type: "string",
                    description: "What action needs to be taken"
                  }
                },
                required: ["email_id", "subject", "from", "importance_reason", "action_required"],
                additionalProperties: false
              },
              description: "List of important emails with details"
            },
            action_plan: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Prioritized list of actions to take"
            },
            key_deadlines: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Important deadlines extracted from emails"
            }
          },
          required: ["executive_summary", "priority_items", "action_plan", "key_deadlines"],
          additionalProperties: false
        },
        strict: true
      }
    }];

    const importantEmails = analysis
      .filter(a => a.importance_score > 0.7)
      .map(a => {
        const email = emails.find(e => e.id === a.email_id);
        return {
          id: a.email_id,
          subject: email?.subject || 'Unknown',
          from: email?.from[0]?.name || email?.from[0]?.email || 'Unknown',
          snippet: email?.snippet || '',
          importance_score: a.importance_score,
          reason: a.reason,
          action_required: a.action_required
        };
      });

    const systemPrompt = `You are an executive email assistant analyzing important emails. Provide:
    1. A clear summary of what needs attention
    2. Detailed breakdown of each important item
    3. A prioritized action plan
    4. Key deadlines to remember
    
    Focus on actionable insights and help the user understand what to do next.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these important emails: ${JSON.stringify(importantEmails)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_important_items" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_important_items') {
      throw new Error('Failed to generate important items insights');
    }

    return JSON.parse(toolCall.arguments);
  }

  async generateResponseNeededInsights(emails: Email[], needsResponse: Email[]): Promise<{
    executive_summary: string;
    response_priorities: Array<{
      email_id: string;
      subject: string;
      from: string;
      urgency: 'high' | 'medium' | 'low';
      suggested_response: string;
      context: string;
    }>;
    response_strategy: string[];
    time_estimate: string;
  }> {
    const tools = [{
      type: "function" as const,
      function: {
        name: "generate_response_insights",
        description: "Generate insights about emails needing responses",
        parameters: {
          type: "object",
          properties: {
            executive_summary: {
              type: "string",
              description: "Summary of emails needing responses with urgency assessment"
            },
            response_priorities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  email_id: {
                    type: "string",
                    description: "Email ID"
                  },
                  subject: {
                    type: "string",
                    description: "Email subject"
                  },
                  from: {
                    type: "string",
                    description: "Sender"
                  },
                  urgency: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "Response urgency level"
                  },
                  suggested_response: {
                    type: "string",
                    description: "Brief suggestion for how to respond"
                  },
                  context: {
                    type: "string",
                    description: "Context about why this needs a response"
                  }
                },
                required: ["email_id", "subject", "from", "urgency", "suggested_response", "context"],
                additionalProperties: false
              },
              description: "Prioritized list of emails needing responses"
            },
            response_strategy: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Strategic recommendations for handling responses"
            },
            time_estimate: {
              type: "string",
              description: "Estimated time needed to respond to all emails"
            }
          },
          required: ["executive_summary", "response_priorities", "response_strategy", "time_estimate"],
          additionalProperties: false
        },
        strict: true
      }
    }];

    const responseData = needsResponse.slice(0, 20).map(email => ({
      id: email.id,
      subject: email.subject,
      from: email.from[0]?.name || email.from[0]?.email || 'Unknown',
      snippet: email.snippet || '',
      date: new Date(email.date * 1000).toLocaleDateString()
    }));

    const systemPrompt = `You are an email response strategist. Analyze emails that need responses and provide:
    1. An executive summary with urgency levels
    2. Prioritized response recommendations
    3. Strategic advice for efficient response handling
    4. Time estimates for completing responses
    
    Help the user tackle their response backlog efficiently.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these emails needing responses: ${JSON.stringify(responseData)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_response_insights" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_response_insights') {
      throw new Error('Failed to generate response insights');
    }

    return JSON.parse(toolCall.arguments);
  }

  async generateAnalyticsInsights(
    emails: Email[],
    timePeriod: string,
    senderStats: Map<string, number>,
    categories: Record<string, number>
  ): Promise<{
    executive_summary: string;
    volume_analysis: {
      trend: string;
      pattern: string;
      anomalies: string[];
    };
    sender_insights: {
      top_relationships: string[];
      communication_balance: string;
      new_contacts: string[];
    };
    productivity_metrics: {
      response_rate: string;
      peak_hours: string[];
      email_habits: string[];
    };
    recommendations: string[];
  }> {
    const tools = [{
      type: "function" as const,
      function: {
        name: "generate_analytics",
        description: "Generate comprehensive email analytics insights",
        parameters: {
          type: "object",
          properties: {
            executive_summary: {
              type: "string",
              description: "High-level summary of email patterns and insights"
            },
            volume_analysis: {
              type: "object",
              properties: {
                trend: {
                  type: "string",
                  description: "Overall volume trend description"
                },
                pattern: {
                  type: "string",
                  description: "Daily/weekly patterns observed"
                },
                anomalies: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Unusual patterns or spikes"
                }
              },
              required: ["trend", "pattern", "anomalies"],
              additionalProperties: false
            },
            sender_insights: {
              type: "object",
              properties: {
                top_relationships: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Most frequent email contacts"
                },
                communication_balance: {
                  type: "string",
                  description: "Analysis of communication patterns"
                },
                new_contacts: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "New contacts in this period"
                }
              },
              required: ["top_relationships", "communication_balance", "new_contacts"],
              additionalProperties: false
            },
            productivity_metrics: {
              type: "object",
              properties: {
                response_rate: {
                  type: "string",
                  description: "Email response rate analysis"
                },
                peak_hours: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Peak email activity hours"
                },
                email_habits: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Observed email habits and patterns"
                }
              },
              required: ["response_rate", "peak_hours", "email_habits"],
              additionalProperties: false
            },
            recommendations: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Actionable recommendations for email management"
            }
          },
          required: ["executive_summary", "volume_analysis", "sender_insights", "productivity_metrics", "recommendations"],
          additionalProperties: false
        },
        strict: true
      }
    }];

    // Prepare analytics data
    const topSenders = Array.from(senderStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sender, count]) => ({ sender, count }));

    const hourlyDistribution = emails.reduce((acc, email) => {
      const hour = new Date(email.date * 1000).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const analyticsData = {
      period: timePeriod,
      total_emails: emails.length,
      unread_count: emails.filter(e => e.unread).length,
      top_senders: topSenders,
      categories: categories,
      hourly_distribution: hourlyDistribution,
      daily_average: emails.length / (timePeriod === 'week' ? 7 : timePeriod === 'month' ? 30 : 1)
    };

    const systemPrompt = `You are an email analytics expert. Analyze email patterns and provide:
    1. Executive summary of key findings
    2. Volume trends and anomalies
    3. Sender relationship insights
    4. Productivity metrics and habits
    5. Actionable recommendations
    
    Focus on insights that help improve email productivity and communication effectiveness.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these email analytics: ${JSON.stringify(analyticsData)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_analytics" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_analytics') {
      throw new Error('Failed to generate analytics insights');
    }

    return JSON.parse(toolCall.arguments);
  }

  async generateRelationshipInsights(
    emails: Email[],
    contactStats: Map<string, { sent: number; received: number; importance: number }>
  ): Promise<{
    executive_summary: string;
    key_relationships: Array<{
      contact: string;
      relationship_type: string;
      communication_style: string;
      insights: string[];
    }>;
    communication_patterns: {
      balance_analysis: string;
      response_patterns: string[];
      collaboration_insights: string[];
    };
    network_insights: {
      growing_relationships: string[];
      neglected_contacts: string[];
      communication_health: string;
    };
    recommendations: string[];
  }> {
    const tools = [{
      type: "function" as const,
      function: {
        name: "generate_relationship_insights",
        description: "Generate insights about email relationships and communication patterns",
        parameters: {
          type: "object",
          properties: {
            executive_summary: {
              type: "string",
              description: "Summary of key relationship insights"
            },
            key_relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  contact: {
                    type: "string",
                    description: "Contact email or name"
                  },
                  relationship_type: {
                    type: "string",
                    description: "Type of relationship (e.g., 'colleague', 'client', 'manager')"
                  },
                  communication_style: {
                    type: "string",
                    description: "Description of communication patterns"
                  },
                  insights: {
                    type: "array",
                    items: {
                      type: "string"
                    },
                    description: "Specific insights about this relationship"
                  }
                },
                required: ["contact", "relationship_type", "communication_style", "insights"],
                additionalProperties: false
              },
              description: "Analysis of key email relationships"
            },
            communication_patterns: {
              type: "object",
              properties: {
                balance_analysis: {
                  type: "string",
                  description: "Analysis of communication balance"
                },
                response_patterns: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Patterns in email responses"
                },
                collaboration_insights: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Insights about collaboration patterns"
                }
              },
              required: ["balance_analysis", "response_patterns", "collaboration_insights"],
              additionalProperties: false
            },
            network_insights: {
              type: "object",
              properties: {
                growing_relationships: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Relationships that are growing stronger"
                },
                neglected_contacts: {
                  type: "array",
                  items: {
                    type: "string"
                  },
                  description: "Contacts that may need more attention"
                },
                communication_health: {
                  type: "string",
                  description: "Overall assessment of communication health"
                }
              },
              required: ["growing_relationships", "neglected_contacts", "communication_health"],
              additionalProperties: false
            },
            recommendations: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Recommendations for improving relationships"
            }
          },
          required: ["executive_summary", "key_relationships", "communication_patterns", "network_insights", "recommendations"],
          additionalProperties: false
        },
        strict: true
      }
    }];

    // Prepare relationship data
    const relationships = Array.from(contactStats.entries())
      .map(([contact, stats]) => ({
        contact,
        total_interactions: stats.sent + stats.received,
        balance: stats.sent / (stats.received || 1),
        avg_importance: stats.importance / (stats.received || 1),
        sent: stats.sent,
        received: stats.received
      }))
      .sort((a, b) => b.total_interactions - a.total_interactions)
      .slice(0, 20);

    const systemPrompt = `You are a relationship analyst specializing in email communication. Analyze communication patterns and provide:
    1. Key relationship insights
    2. Communication style analysis
    3. Network health assessment
    4. Actionable recommendations
    
    Focus on helping improve professional relationships and communication effectiveness.`;

    const completion = await (this.openai as any).responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze these email relationships: ${JSON.stringify(relationships)}` }
      ],
      tools: tools,
      tool_choice: { type: "function", name: "generate_relationship_insights" },
      ...this.buildGpt5Params()
    });

    const toolCall = this.extractFirstToolCall(completion);
    if (!toolCall || toolCall.name !== 'generate_relationship_insights') {
      throw new Error('Failed to generate relationship insights');
    }

    return JSON.parse(toolCall.arguments);
  }
}