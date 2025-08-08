# End-to-End Testing Documentation

This directory contains comprehensive end-to-end tests for the Inbox MCP email assistant. These tests validate real functionality using actual OpenAI and Nylas APIs.

## 🚀 Quick Start

### 1. Set Up Test Credentials

Copy the example environment file and add your test credentials:

```bash
cp .env.test.example .env.test
```

Edit `.env.test` with:
- `NYLAS_GRANT_ID`: Your Nylas grant ID (from Hosted Auth callback)
- `OPENAI_API_KEY`: Your OpenAI API key
- `TEST_EMAIL_ADDRESS`: An email address accessible via Nylas

⚠️ **Important**: Use a test email account to avoid affecting production data!

### 2. Build the Project

```bash
npm run build
```

### 3. Run E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test suite
npm run test:e2e setup.test.ts

# Run in interactive mode (with user prompts)
npm run test:e2e:interactive

# Run in watch mode for development
npm run test:e2e:watch
```

## 📁 Test Structure

### Test Suites

1. **setup.test.ts** - User onboarding and configuration
   - Initial setup flow
   - Credential validation
   - Tool availability verification
   - Nylas connection testing

2. **aiTools.test.ts** - AI-powered email tools
   - ManageEmail: Send, reply, forward, draft
   - FindEmails: Natural language search
   - OrganizeInbox: Smart organization
   - EmailInsights: Analytics and summaries
   - SmartFolders: AI-generated folder rules

3. **approval.test.ts** - Human-in-the-loop workflows
   - Approval request generation
   - Interactive approval/rejection
   - Modification handling
   - Edge cases (expired, rapid cycles)

4. **mcpServer.test.ts** - MCP protocol compliance
   - JSON-RPC 2.0 compliance
   - Tool registration and discovery
   - Error handling
   - Concurrent request handling

5. **complexScenarios.test.ts** - Real-world workflows
   - Multi-step email conversations
   - Email triage and organization
   - Error recovery
   - Performance testing
   - Monday morning routine simulation

### Utilities

- **testClient.ts**: MCP client for simulating Juli's interactions
- **llmGrader.ts**: Simple OpenAI-based response grader
- **interactivePrompt.ts**: Terminal prompts for user interaction
- **testData.ts**: Test scenarios and data generation
- **config.ts**: Test configuration and thresholds

## 🎯 Testing Approach

### LLM Grading

Tests use a simple LLM grader that evaluates responses on four criteria:

1. **Query Understanding** (30%): Did the AI understand the request?
2. **Action Accuracy** (30%): Were the correct actions taken?
3. **Response Quality** (20%): Is the response helpful and complete?
4. **Error Handling** (20%): Were errors handled gracefully?

Passing score: 70/100
Excellent score: 90/100

### Interactive Testing

Some tests support interactive mode where you can:
- Review and approve email operations
- Enter custom test queries
- See real-time results
- Simulate user workflows

Run with `npm run test:e2e:interactive` to enable prompts.

### Test Data Management

- Test emails are prefixed with `[E2E Test]`
- Automatic cleanup after tests (configurable)
- Isolated test operations using dry_run mode

## 🔧 Configuration

Edit `tests/e2e/config.ts` to adjust:

- API credentials and endpoints
- Timeout values
- Grading thresholds
- Interactive mode settings
- Test data preferences

## 📊 CI/CD Integration

For continuous integration:

1. Set environment variables in CI:
   ```
   NYLAS_GRANT_ID=<test_grant>
   OPENAI_API_KEY=<api_key>
   TEST_EMAIL_ADDRESS=<test_email>
   CI=true
   ```

2. Run tests in CI mode (skips interactive prompts):
   ```bash
   CI=true npm run test:e2e
   ```

## 🐛 Troubleshooting

### Common Issues

1. **"Missing required test environment variables"**
   - Ensure `.env.test` exists with all required variables
   - Check that credentials are valid

2. **"Request timeout" errors**
   - Increase timeouts in `config.ts`
   - Check network connectivity
   - Verify API endpoints are accessible

3. **"No emails found" in tests**
   - Ensure test email account has some emails
   - Check Nylas grant permissions
   - Verify email sync is working

4. **Low grading scores**
   - Review the grading feedback
   - Check if AI responses match expectations
   - Adjust grading criteria if needed

### Debug Mode

Set `NODE_ENV=development` for verbose logging:
```bash
NODE_ENV=development npm run test:e2e
```

## 🤝 Contributing

When adding new E2E tests:

1. Follow the existing test structure
2. Use meaningful test descriptions
3. Include grading criteria for AI responses
4. Add both automated and interactive variants
5. Document any new test utilities
6. Ensure tests are idempotent

## 📝 Test Writing Guidelines

### Good E2E Test Example

```typescript
it('should handle natural language email search', async () => {
  // Clear description of what we're testing
  const scenario = {
    name: 'Email search with time context',
    tool: 'find_emails',
    input: { query: 'Find important emails from last week' },
    expectedBehavior: 'Returns relevant recent emails',
    gradingCriteria: {
      queryUnderstanding: 'Correctly interprets time range and importance',
      actionAccuracy: 'Filters to last 7 days and assesses importance',
      responseQuality: 'Provides useful email summaries',
      errorHandling: 'Handles empty results gracefully'
    }
  };
  
  // Execute the test
  const response = await client.callTool(scenario.tool, scenario.input);
  const result = extractResponseText(response);
  
  // Grade with LLM
  const grade = await grader.gradeResponse(scenario, result);
  
  // Display results
  InteractivePrompt.displayGradingResult(grade);
  
  // Assert minimum quality
  expect(grade.overall).toBeGreaterThanOrEqual(70);
});
```

## 🔒 Security Notes

- Never commit `.env.test` files
- Use dedicated test accounts
- Avoid testing with production data
- Regularly rotate test credentials
- Monitor API usage and costs