/**
 * Configuration for E2E tests
 * Provides test credentials and server configuration
 */

export interface E2EConfig {
  server: {
    url: string;
    port: number;
  };
  nylas?: {
    nylasAccessToken: string;
    nylasGrantId: string;
  };
  testTimeout: number;
  logging: {
    verbose: boolean;        // Detailed logging for all operations
    logApiCalls: boolean;    // Log all API requests/responses
    logTimings: boolean;     // Log operation timings
    saveResponses: boolean;  // Save API responses to files
  };
  testData: {
    testEmailPrefix: string; // e.g., "[E2E-TEST]"
    cleanupAfterTest: boolean;
    testRecipientEmail: string; // Your test email
  };
}

// Load configuration from environment variables or use defaults
export const E2E_CONFIG: E2EConfig = {
  server: {
    url: process.env.SERVER_URL || 'http://localhost',
    port: parseInt(process.env.PORT || '3000', 10)
  },
  nylas: process.env.NYLAS_ACCESS_TOKEN && process.env.NYLAS_GRANT_ID ? {
    nylasAccessToken: process.env.NYLAS_ACCESS_TOKEN,
    nylasGrantId: process.env.NYLAS_GRANT_ID
  } : undefined,
  testTimeout: parseInt(process.env.TEST_TIMEOUT || '30000', 10),
  logging: {
    verbose: process.env.VERBOSE === 'true' || process.env.LOG_LEVEL === 'verbose',
    logApiCalls: process.env.LOG_API_CALLS === 'true',
    logTimings: process.env.LOG_TIMINGS === 'true',
    saveResponses: process.env.SAVE_RESPONSES === 'true'
  },
  testData: {
    testEmailPrefix: process.env.TEST_PREFIX || '[E2E-TEST]',
    cleanupAfterTest: process.env.CLEANUP !== 'false', // Default true
    testRecipientEmail: process.env.TEST_EMAIL_ADDRESS || ''
  }
};

// Helper to check if E2E tests should run
export function shouldRunE2ETests(): boolean {
  // E2E tests can run with or without Nylas credentials
  // Without credentials, only setup-related tests will work
  return process.env.RUN_E2E_TESTS === 'true' || process.env.CI === 'true';
}

// Helper to check if Nylas integration tests should run
export function hasNylasCredentials(): boolean {
  return !!E2E_CONFIG.nylas?.nylasAccessToken && !!E2E_CONFIG.nylas?.nylasGrantId;
}