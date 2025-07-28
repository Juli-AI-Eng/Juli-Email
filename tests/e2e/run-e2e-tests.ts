#!/usr/bin/env node
/**
 * E2E test runner with environment validation
 * Ensures all required APIs and configurations are present
 */

import * as dotenv from 'dotenv';
import { spawn } from 'child_process';
import { logger } from './utils/testLogger';

// Load standard environment
dotenv.config();

// Environment validation
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateEnvironment(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };
  
  // Check OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    result.errors.push('OPENAI_API_KEY is not set. Required for AI features.');
    result.valid = false;
  } else if (process.env.OPENAI_API_KEY.length < 20) {
    result.errors.push('OPENAI_API_KEY appears to be invalid (too short).');
    result.valid = false;
  }
  
  // Check Nylas credentials
  if (!process.env.NYLAS_ACCESS_TOKEN || !process.env.NYLAS_GRANT_ID) {
    result.warnings.push('Nylas credentials not found. Only setup tests will run.');
    result.warnings.push('Set NYLAS_ACCESS_TOKEN and NYLAS_GRANT_ID to run full tests.');
  } else {
    // Validate format
    if (!process.env.NYLAS_ACCESS_TOKEN.startsWith('nyk_')) {
      result.errors.push('NYLAS_ACCESS_TOKEN should start with "nyk_"');
      result.valid = false;
    }
    
    // Basic UUID validation for grant ID
    const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if (!uuidRegex.test(process.env.NYLAS_GRANT_ID)) {
      result.errors.push('NYLAS_GRANT_ID should be a valid UUID');
      result.valid = false;
    }
  }
  
  // Check test email
  if (!process.env.TEST_EMAIL_ADDRESS) {
    result.warnings.push('TEST_EMAIL_ADDRESS not set. Email sending tests will use fallback.');
  } else {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(process.env.TEST_EMAIL_ADDRESS)) {
      result.errors.push('TEST_EMAIL_ADDRESS is not a valid email format');
      result.valid = false;
    }
  }
  
  // Check optional settings
  if (process.env.VERBOSE === 'true') {
    result.warnings.push('Verbose logging is enabled. Output will be detailed.');
  }
  
  if (process.env.SAVE_RESPONSES === 'true') {
    result.warnings.push('Response saving is enabled. Check test-responses/ directory.');
  }
  
  return result;
}

function printEnvironmentSummary() {
  logger.logSection('E2E Test Environment Summary');
  
  console.log('API Keys:');
  console.log(`  ✓ OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Set' : '✗ Missing'}`);
  
  console.log('\nNylas Configuration:');
  console.log(`  ${process.env.NYLAS_ACCESS_TOKEN ? '✓' : '✗'} Access Token: ${
    process.env.NYLAS_ACCESS_TOKEN ? 'Set' : 'Missing'
  }`);
  console.log(`  ${process.env.NYLAS_GRANT_ID ? '✓' : '✗'} Grant ID: ${
    process.env.NYLAS_GRANT_ID ? 'Set' : 'Missing'
  }`);
  
  console.log('\nTest Configuration:');
  console.log(`  Test Email: ${process.env.TEST_EMAIL_ADDRESS || 'Not set'}`);
  console.log(`  Test Prefix: ${process.env.TEST_PREFIX || '[E2E-TEST]'}`);
  console.log(`  Cleanup After Test: ${process.env.CLEANUP !== 'false' ? 'Yes' : 'No'}`);
  
  console.log('\nLogging Configuration:');
  console.log(`  Verbose: ${process.env.VERBOSE === 'true' ? 'Yes' : 'No'}`);
  console.log(`  Log API Calls: ${process.env.LOG_API_CALLS === 'true' ? 'Yes' : 'No'}`);
  console.log(`  Log Timings: ${process.env.LOG_TIMINGS === 'true' ? 'Yes' : 'No'}`);
  console.log(`  Save Responses: ${process.env.SAVE_RESPONSES === 'true' ? 'Yes' : 'No'}`);
}

function runTests(testPattern?: string): Promise<number> {
  return new Promise((resolve) => {
    const args = ['test:e2e'];
    
    if (testPattern) {
      args.push('--', testPattern);
    }
    
    const child = spawn('npm', ['run', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        RUN_E2E_TESTS: 'true'
      }
    });
    
    child.on('exit', (code) => {
      resolve(code || 0);
    });
  });
}

async function main() {
  logger.logSection('Inbox MCP E2E Test Runner');
  
  // Validate environment
  const validation = validateEnvironment();
  
  // Show environment summary
  printEnvironmentSummary();
  
  // Display validation results
  if (validation.errors.length > 0) {
    logger.logSection('Environment Validation Errors');
    validation.errors.forEach(error => logger.logError(error));
  }
  
  if (validation.warnings.length > 0) {
    logger.logSection('Environment Warnings');
    validation.warnings.forEach(warning => logger.logWarning(warning));
  }
  
  if (!validation.valid) {
    logger.logError('\nEnvironment validation failed. Please fix the errors above.');
    logger.logInfo('Copy .env.test.example to .env.test and fill in your credentials.');
    process.exit(1);
  }
  
  // Check for test pattern argument
  const testPattern = process.argv[2];
  
  logger.logSection('Running E2E Tests');
  
  if (testPattern) {
    logger.logInfo(`Running tests matching pattern: ${testPattern}`);
  } else {
    logger.logInfo('Running all E2E tests...');
  }
  
  try {
    const exitCode = await runTests(testPattern);
    
    if (exitCode === 0) {
      logger.logSuccess('\nAll tests passed! 🎉');
    } else {
      logger.logError(`\nTests failed with exit code ${exitCode}`);
    }
    
    process.exit(exitCode);
  } catch (error) {
    logger.logError('Failed to run tests', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  logger.logError('Unhandled rejection:', error);
  process.exit(1);
});

// Run the test runner
main();