import Nylas from 'nylas';
import { SetupResponse, SetupInstruction } from '../types/index.js';

export class SetupManager {
  private async testEmailConnection(credentials: any): Promise<SetupResponse> {
    try {
      const testClient = new Nylas({ 
        apiKey: credentials.nylas_api_key,
        apiUri: process.env.NYLAS_API_URI || 'https://api.us.nylas.com'
      });
      
      // Test by fetching recent messages (lightweight operation)
      const messages = await testClient.messages.list({
        identifier: credentials.nylas_grant_id,
        queryParams: {
          limit: 1
        }
      });
      
      // Also get grant info for more details
      const grant = await testClient.grants.find({
        grantId: credentials.nylas_grant_id
      });
      
      const emailAddress = grant.data.email || 'your email';
      
      return {
        type: 'setup_success',
        message: `Connection successful! Connected to ${emailAddress} (${grant.data.provider}). Messages accessible: ${messages.data.length > 0 ? 'Yes' : 'No'}`,
        credentials_validated: true,
        credentials_to_store: {
          nylas_api_key: credentials.nylas_api_key,
          nylas_grant_id: credentials.nylas_grant_id,
          email_address: emailAddress,
          provider: grant.data.provider
        }
      };
    } catch (error: any) {
      return {
        type: 'setup_error',
        message: 'Connection test failed',
        error_details: error.message || 'Could not connect to email account'
      };
    }
  }

  async handleSetup(params: any): Promise<SetupResponse> {
    const { action, credentials } = params;

    switch (action) {
      case 'get_instructions':
        return this.getInstructions();
      
      case 'validate_credentials':
        if (!credentials) {
          return {
            type: 'validation_error',
            message: 'No credentials provided',
            missing_fields: ['credentials']
          };
        }
        return this.validateCredentials(credentials);
      
      case 'test_connection':
        // Test the connection using provided credentials or environment variables
        const testCredentials = credentials || {
          nylas_api_key: process.env.NYLAS_API_KEY || '',
          nylas_grant_id: process.env.NYLAS_GRANT_ID || ''
        };
        
        if (!testCredentials.nylas_api_key || !testCredentials.nylas_grant_id) {
          return {
            type: 'setup_error',
            message: 'Missing credentials for connection test',
            error_details: 'Please provide nylas_api_key and nylas_grant_id'
          };
        }
        
        return this.testEmailConnection(testCredentials);

      case 'troubleshoot':
        return this.troubleshoot(params.issue || 'general issue');
      
      default:
        return {
          type: 'setup_error',
          message: `Unknown setup action: ${action}`
        };
    }
  }

  async getInstructions(): Promise<SetupResponse> {
    return {
      type: 'setup_instructions',
      title: 'Email Setup Guide',
      estimated_time: '5 minutes',
      steps: [
        {
          step: 1,
          title: 'Create Your Free Nylas Account',
          description: 'Nylas provides 5 free email connections - perfect for personal use!',
          actions: [
            {
              type: 'link',
              label: 'Open Nylas Signup',
              url: 'https://dashboard-v3.nylas.com/register?utm_source=juli',
            }
          ],
          tips: [
            'Use the same email you\'ll be connecting later',
            'No credit card required for free tier'
          ]
        },
        {
          step: 2,
          title: 'Get Your API Key',
          description: 'After signing in, find your API key in the dashboard',
          actions: [
            {
              type: 'copy_field',
              label: 'I\'ll paste my API key here',
              field: 'nylas_api_key',
              validation: 'regex:^nyk_[a-zA-Z0-9]+$'
            }
          ],
          tips: [
            'API key starts with \'nyk_\'',
            'Keep this key secret - it\'s like a password!'
          ]
        },
        {
          step: 3,
          title: 'Connect Your Email Account',
          description: 'Add your email account to Nylas',
          substeps: [
            'Click \'Grants\' in the sidebar',
            'Click \'Add Test Grant\' button (top right)',
            'Choose your email provider (Gmail, Outlook, etc)',
            'Authorize Nylas to access your email',
            'Copy the Grant ID that appears'
          ],
          actions: [
            {
              type: 'copy_field',
              label: 'I\'ll paste my Grant ID here',
              field: 'nylas_grant_id',
              validation: 'regex:^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
            }
          ],
          common_issues: [
            {
              issue: 'Can\'t find Grant ID',
              solution: 'It\'s in the table under the \'ID\' column after you connect'
            },
            {
              issue: 'Authorization failed',
              solution: 'Make sure to allow all requested permissions'
            }
          ]
        }
      ],
      next_step: {
        description: 'Once you have both credentials, validate them through Juli',
        command: 'setup_email_connection',
        parameters: {
          action: 'validate_credentials',
          credentials: {
            nylas_api_key: 'your_key_here',
            nylas_grant_id: 'your_grant_id_here'
          }
        }
      }
    };
  }

  async validateCredentials(
    credentials: any
  ): Promise<SetupResponse> {
    // Debug logging
    console.log('Validating credentials:', {
      hasApiKey: !!credentials?.nylas_api_key,
      apiKeyPrefix: credentials?.nylas_api_key?.substring(0, 10) + '...',
      grantId: credentials?.nylas_grant_id
    });
    
    // Check for missing credentials
    if (!credentials?.nylas_api_key || !credentials?.nylas_grant_id) {
      return {
        type: 'validation_error',
        message: 'Both API key and Grant ID are required',
        missing_fields: [
          !credentials?.nylas_api_key && 'nylas_api_key',
          !credentials?.nylas_grant_id && 'nylas_grant_id'
        ].filter(Boolean) as string[]
      };
    }

    // Validate API key format
    if (!credentials.nylas_api_key.startsWith('nyk_')) {
      return {
        type: 'validation_error',
        message: 'API key should start with \'nyk_\'',
      };
    }

    // Validate Grant ID format (UUID)
    const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if (!uuidRegex.test(credentials.nylas_grant_id)) {
      return {
        type: 'validation_error',
        message: 'Grant ID should be a valid UUID',
      };
    }

    try {
      // Test the credentials
      console.log('Creating Nylas client with API key:', credentials.nylas_api_key.substring(0, 20) + '...');
      const testClient = new Nylas({ apiKey: credentials.nylas_api_key });
      
      // Try to fetch grant info to verify
      console.log('Fetching grant:', credentials.nylas_grant_id);
      const grant = await testClient.grants.find({
        grantId: credentials.nylas_grant_id
      });

      // Get email address for confirmation
      const emailAddress = grant.data.email || 'your email';

      return {
        type: 'setup_success',
        message: `Successfully connected ${emailAddress}!`,
        credentials_validated: true,
        credentials_to_store: {
          nylas_api_key: credentials.nylas_api_key,
          nylas_grant_id: credentials.nylas_grant_id,
          email_address: emailAddress,
          provider: grant.data.provider
        }
      };
    } catch (error: any) {
      // Log the full error for debugging
      console.error('Nylas validation error:', {
        statusCode: error.statusCode,
        message: error.message,
        type: error.type,
        providerError: error.provider_error,
        requestId: error.request_id,
        fullError: error
      });
      
      // Handle different error types
      if (error.statusCode === 401) {
        return {
          type: 'setup_error',
          message: 'Invalid API key',
          error_details: 'Double-check your API key from the Nylas dashboard'
        };
      } else if (error.statusCode === 404) {
        return {
          type: 'setup_error',
          message: 'Grant ID not found',
          error_details: 'Make sure you completed the \'Add Test Grant\' step'
        };
      } else {
        return {
          type: 'setup_error',
          message: 'Could not connect to Nylas',
          error_details: error.message
        };
      }
    }
  }

  async troubleshoot(issue: string): Promise<SetupResponse> {
    const lowerIssue = issue.toLowerCase();

    // Check for permission issues
    if (lowerIssue.includes('permission') || lowerIssue.includes('denied') || lowerIssue.includes('access')) {
      return {
        type: 'setup_instructions',
        title: 'Permission Issue Resolution',
        estimated_time: '2 minutes',
        steps: [
          {
            step: 1,
            title: 'Re-authorize Your Email',
            description: 'Re-authorize your email in Nylas dashboard with all permissions enabled',
            substeps: [
              'Go to Nylas dashboard',
              'Find your grant in the Grants section',
              'Delete the existing grant',
              'Create a new test grant',
              'Make sure to allow ALL requested permissions'
            ]
          }
        ]
      };
    }

    // Check for expired grant
    if (lowerIssue.includes('expired') || lowerIssue.includes('invalid grant')) {
      return {
        type: 'setup_instructions',
        title: 'Grant Expired - Create New Grant',
        estimated_time: '3 minutes',
        steps: [
          {
            step: 1,
            title: 'Create a New Test Grant',
            description: 'Test grants expire after 30 days. Let\'s create a fresh one.',
            substeps: [
              'Go to Nylas dashboard',
              'Navigate to Grants section',
              'Click \'Add Test Grant\'',
              'Re-authorize your email',
              'Copy the new Grant ID'
            ]
          }
        ]
      };
    }

    // Generic troubleshooting
    return {
      type: 'setup_instructions',
      title: 'General Troubleshooting',
      estimated_time: '5 minutes',
      steps: [
        {
          step: 1,
          title: 'Verify Your Nylas Account',
          description: 'Make sure your Nylas account is active'
        },
        {
          step: 2,
          title: 'Check API Key Validity',
          description: 'Ensure your API key is still valid and not regenerated'
        },
        {
          step: 3,
          title: 'Verify Email Grant',
          description: 'Check if your email grant hasn\'t expired (30 days for test grants)'
        },
        {
          step: 4,
          title: 'Try Creating Fresh Credentials',
          description: 'Sometimes starting fresh with new grant helps'
        }
      ]
    };
  }
}