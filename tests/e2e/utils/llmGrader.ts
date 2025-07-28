import OpenAI from 'openai';
import { E2E_CONFIG } from '../config';
import { TestScenario } from './testData';

export interface GradingResult {
  queryUnderstanding: number;
  actionAccuracy: number;
  responseQuality: number;
  errorHandling: number;
  overall: number;
  feedback: string;
}

export class LLMGrader {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: E2E_CONFIG.openai.apiKey
    });
  }

  async gradeResponse(
    scenario: TestScenario,
    actualResponse: string,
    additionalContext?: any
  ): Promise<GradingResult> {
    const prompt = this.buildGradingPrompt(scenario, actualResponse, additionalContext);
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: E2E_CONFIG.openai.graderModel,
        messages: [
          {
            role: 'system',
            content: `You are a test grader for an email management AI assistant. 
Grade the response based on the criteria provided and return scores from 0-100 for each criterion.
Be fair but strict - the assistant should handle email operations correctly and safely.
Return your response as valid JSON.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      // Calculate overall score
      const weights = E2E_CONFIG.grading.criteria;
      const overall = Math.round(
        result.queryUnderstanding * weights.queryUnderstanding.weight +
        result.actionAccuracy * weights.actionAccuracy.weight +
        result.responseQuality * weights.responseQuality.weight +
        result.errorHandling * weights.errorHandling.weight
      );

      return {
        queryUnderstanding: result.queryUnderstanding || 0,
        actionAccuracy: result.actionAccuracy || 0,
        responseQuality: result.responseQuality || 0,
        errorHandling: result.errorHandling || 0,
        overall,
        feedback: result.feedback || 'No feedback provided'
      };
    } catch (error) {
      console.error('Grading failed:', error);
      return {
        queryUnderstanding: 0,
        actionAccuracy: 0,
        responseQuality: 0,
        errorHandling: 0,
        overall: 0,
        feedback: `Grading failed: ${error}`
      };
    }
  }

  private buildGradingPrompt(
    scenario: TestScenario,
    actualResponse: string,
    additionalContext?: any
  ): string {
    const criteria = scenario.gradingCriteria || {
      queryUnderstanding: 'Did the system understand the user query correctly?',
      actionAccuracy: 'Were the correct actions taken?',
      responseQuality: 'Was the response helpful and complete?',
      errorHandling: 'Were errors handled appropriately?'
    };

    return `
## Test Scenario: ${scenario.name}

**Description**: ${scenario.description}
**Tool Used**: ${scenario.tool}
**Input**: ${JSON.stringify(scenario.input, null, 2)}
**Expected Behavior**: ${scenario.expectedBehavior}

## Actual Response
${actualResponse}

${additionalContext ? `## Additional Context\n${JSON.stringify(additionalContext, null, 2)}` : ''}

## Grading Criteria

Please grade the response on a scale of 0-100 for each criterion:

1. **Query Understanding** (0-100): ${criteria.queryUnderstanding}
2. **Action Accuracy** (0-100): ${criteria.actionAccuracy}
3. **Response Quality** (0-100): ${criteria.responseQuality}
4. **Error Handling** (0-100): ${criteria.errorHandling}

Return your response as JSON with this structure:
{
  "queryUnderstanding": <score>,
  "actionAccuracy": <score>,
  "responseQuality": <score>,
  "errorHandling": <score>,
  "feedback": "<brief explanation of the scores>"
}
`;
  }

  async gradeEmailOperation(
    operation: string,
    expectedResult: any,
    actualResult: any
  ): Promise<GradingResult> {
    // Simplified grading for specific email operations
    const prompt = `
Grade this email operation:

**Operation**: ${operation}
**Expected Result**: ${JSON.stringify(expectedResult, null, 2)}
**Actual Result**: ${JSON.stringify(actualResult, null, 2)}

Grade based on:
1. Query Understanding: Did the system correctly interpret the request?
2. Action Accuracy: Was the email operation performed correctly?
3. Response Quality: Was the response clear and informative?
4. Error Handling: Were any errors handled appropriately?

Return scores 0-100 for each criterion as JSON.
`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: E2E_CONFIG.openai.graderModel,
        messages: [
          {
            role: 'system',
            content: 'You are grading an email AI assistant. Return scores as JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      const weights = E2E_CONFIG.grading.criteria;
      const overall = Math.round(
        (result.queryUnderstanding || 0) * weights.queryUnderstanding.weight +
        (result.actionAccuracy || 0) * weights.actionAccuracy.weight +
        (result.responseQuality || 0) * weights.responseQuality.weight +
        (result.errorHandling || 0) * weights.errorHandling.weight
      );

      return {
        queryUnderstanding: result.queryUnderstanding || 0,
        actionAccuracy: result.actionAccuracy || 0,
        responseQuality: result.responseQuality || 0,
        errorHandling: result.errorHandling || 0,
        overall,
        feedback: result.feedback || ''
      };
    } catch (error) {
      return {
        queryUnderstanding: 0,
        actionAccuracy: 0,
        responseQuality: 0,
        errorHandling: 0,
        overall: 0,
        feedback: `Grading failed: ${error}`
      };
    }
  }
}