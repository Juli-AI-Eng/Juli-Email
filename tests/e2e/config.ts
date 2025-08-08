export const E2E_CONFIG = {
  // API Configuration
  nylas: {
    grantId: process.env.NYLAS_GRANT_ID!,
    testEmail: process.env.TEST_EMAIL_ADDRESS!
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o-mini', // Use cheaper model for tests
    graderModel: 'gpt-4o-mini'
  },

  // Test Configuration
  timeouts: {
    default: 30000,
    approval: 60000,
    setup: 120000
  },

  // Grading Thresholds (0-100)
  grading: {
    passingScore: 70,
    excellentScore: 90,
    criteria: {
      queryUnderstanding: { weight: 0.3 },
      actionAccuracy: { weight: 0.3 },
      responseQuality: { weight: 0.2 },
      errorHandling: { weight: 0.2 }
    }
  },

  // Interactive Mode
  interactive: {
    enabled: process.env.CI !== 'true',
    approvalTimeout: 30000
  },

  // Test Data
  testData: {
    emailPrefix: '[E2E Test]',
    cleanupAfterTests: true
  }
};