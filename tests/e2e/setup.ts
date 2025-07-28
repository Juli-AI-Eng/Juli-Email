import dotenv from 'dotenv';

// Load environment variables from standard .env
dotenv.config();

// Only require OpenAI API key - Nylas credentials are optional
const requiredVars = ['OPENAI_API_KEY'];
const optionalVars = ['NYLAS_ACCESS_TOKEN', 'NYLAS_GRANT_ID', 'TEST_EMAIL_ADDRESS'];

const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('Missing required environment variables:', missing);
  console.error('Please add them to your .env file');
  process.exit(1);
}

// Log optional variables status
const missingOptional = optionalVars.filter(v => !process.env[v]);
if (missingOptional.length > 0) {
  console.log('Note: Some optional variables are not set:', missingOptional);
  console.log('Some tests will be skipped');
}

// Set longer timeout for E2E tests
jest.setTimeout(60000);

// Global test helpers
global.testHelpers = {
  waitForUser: async (message: string) => {
    if (process.env.CI === 'true') {
      console.log(`CI Mode: Skipping user interaction - ${message}`);
      return;
    }
    console.log(`\n${message}\nPress Enter to continue...`);
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
  }
};