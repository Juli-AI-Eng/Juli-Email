// Email AI Types
export interface EmailIntent {
  intent: 'send' | 'reply' | 'forward' | 'find' | 'organize';
  recipients?: string[];
  subject?: string;
  key_points: string[];
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  tone: 'professional' | 'casual' | 'friendly' | 'formal' | 'grateful';
  context_message_id?: string;
}

export interface GeneratedEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  in_reply_to?: string;
  tone_confirmation?: string;
}

export interface EmailAnalysis {
  email_id: string;
  importance_score: number; // 0-1
  category: 'urgent_alert' | 'client_email' | 'newsletter' | 'notification' | 'personal' | 'other';
  reason: string;
  action_required: boolean;
  suggested_folder?: string;
}

export interface ActionItem {
  task: string;
  deadline?: string;
  priority: 'low' | 'medium' | 'high';
  assigned_to?: string;
}

export interface EmailSummary {
  total_emails: number;
  important_count: number;
  requires_response: number;
  categories: Record<string, number>;
  key_senders: string[];
  urgent_items: string[];
}

// Approval System Types - Legacy (removed)

// New stateless approval response that includes all action data
export interface ApprovalRequiredResponse {
  needs_approval: true;
  action_type: 'send_email' | 'organize_inbox' | 'apply_smart_folder';
  action_data: any; // Contains all data needed to execute the action
  preview: {
    summary: string;
    details: any;
    risks?: string[];
  };
  suggested_modifications?: any;
}

// Response for when an approved action is executed
export interface ApprovedActionResponse {
  success: boolean;
  message: string;
  result?: any;
}

// Legacy approval types removed - using stateless approval flow

// Setup Types
export interface SetupInstruction {
  step: number;
  title: string;
  description: string;
  actions?: {
    type: 'link' | 'copy_field';
    label: string;
    url?: string;
    field?: string;
    validation?: string;
  }[];
  substeps?: string[];
  tips?: string[];
  common_issues?: {
    issue: string;
    solution: string;
  }[];
}

export interface SetupResponse {
  type: 'setup_instructions' | 'setup_success' | 'setup_error' | 'validation_error';
  title?: string;
  estimated_time?: string;
  steps?: SetupInstruction[];
  next_step?: {
    description: string;
    command: string;
    parameters: any;
  };
  message?: string;
  credentials_validated?: boolean;
  credentials_to_store?: {
    nylas_api_key: string;
    nylas_grant_id: string;
    email_address?: string;
    provider?: string;
  };
  error_details?: string;
  missing_fields?: string[];
}

// MCP Context Types
export interface MCPContext {
  userId: string;
  credentials?: {
    nylas_api_key?: string;
    nylas_grant_id?: string;
  };
  approvalToken?: string;
}

// Email types (simplified from Nylas)
export interface Email {
  id: string;
  subject: string;
  from: { email: string; name?: string }[];
  to?: { email: string; name?: string }[];
  body?: string;
  snippet?: string;
  date?: number;
  unread?: boolean;
  starred?: boolean;
  folders?: string[];
  thread_id?: string;
}

// Tool Parameter Types
export interface ManageEmailParams {
  action: 'send' | 'reply' | 'forward' | 'draft';
  query: string;
  context_message_id?: string;
  require_approval?: boolean;
  
  // Context injection fields from Juli
  user_name?: string;
  user_email?: string;
  
  // Fields for stateless approval flow
  approved?: boolean;
  action_data?: {
    email_content: GeneratedEmail;
    original_params: any;
  };
}

export interface FindEmailsParams {
  query: string;
  analysis_type?: 'full' | 'summary' | 'detailed' | 'action_items' | 'priority';
  limit?: number;
}

export interface OrganizeInboxParams {
  instruction: string;
  scope?: {
    folder?: string;
    date_range?: string;
    limit?: number;
  };
  dry_run?: boolean;
  
  // New fields for stateless approval flow
  approved?: boolean;
  action_data?: {
    organization_plan: any;
    original_params: any;
  };
}

export interface EmailInsightsParams {
  query: string;
  time_period?: string;
}

export interface SmartFoldersParams {
  query: string;
  folder_name?: string;
  dry_run?: boolean;
  
  // New fields for stateless approval flow
  approved?: boolean;
  action_data?: {
    folder_plan: any;
    original_params: any;
  };
}