import prompts from 'prompts';
import { E2E_CONFIG } from '../config';

export interface ApprovalRequest {
  id: string;
  action: string;
  preview: {
    summary: string;
    details?: any;
    risks?: string[];
  };
  expires_at: number;
  modifications_allowed: boolean;
}

export class InteractivePrompt {
  static async getCredentials(): Promise<{
    nylas_api_key: string;
    nylas_grant_id: string;
    openai_api_key: string;
  }> {
    console.log('\n=== MCP Email Assistant Setup ===\n');
    
    const response = await prompts([
      {
        type: 'password',
        name: 'nylas_api_key',
        message: 'Enter your Nylas API Key:',
        validate: (value: string) => value.length > 0 || 'API Key is required'
      },
      {
        type: 'text',
        name: 'nylas_grant_id',
        message: 'Enter your Nylas Grant ID:',
        validate: (value: string) => value.length > 0 || 'Grant ID is required'
      },
      {
        type: 'password',
        name: 'openai_api_key',
        message: 'Enter your OpenAI API Key:',
        validate: (value: string) => value.length > 0 || 'OpenAI API Key is required'
      }
    ]);

    return response;
  }

  static async approveAction(approval: ApprovalRequest): Promise<{
    action: 'approve' | 'reject' | 'modify';
    modifications?: any;
  }> {
    if (!E2E_CONFIG.interactive.enabled) {
      console.log('CI Mode: Auto-approving action');
      return { action: 'approve' };
    }

    console.log('\n=== Approval Required ===\n');
    console.log(`Action: ${approval.action}`);
    console.log(`Summary: ${approval.preview.summary}`);
    
    if (approval.preview.details) {
      console.log('\nDetails:');
      console.log(JSON.stringify(approval.preview.details, null, 2));
    }
    
    if (approval.preview.risks && approval.preview.risks.length > 0) {
      console.log('\n⚠️  Risks:');
      approval.preview.risks.forEach(risk => console.log(`  - ${risk}`));
    }
    
    console.log(`\nApproval ID: ${approval.id}`);
    console.log(`Expires: ${new Date(approval.expires_at).toLocaleString()}\n`);

    const choices = [
      { title: 'Approve', value: 'approve' },
      { title: 'Reject', value: 'reject' }
    ];
    
    if (approval.modifications_allowed) {
      choices.push({ title: 'Modify', value: 'modify' });
    }

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices
    });

    if (response.action === 'modify') {
      const modifications = await prompts({
        type: 'text',
        name: 'modifications',
        message: 'Enter modifications as JSON:',
        validate: (value: string) => {
          try {
            JSON.parse(value);
            return true;
          } catch {
            return 'Please enter valid JSON';
          }
        }
      });
      
      return {
        action: 'modify',
        modifications: JSON.parse(modifications.modifications)
      };
    }

    return { action: response.action };
  }

  static async waitForUserInput(message: string): Promise<void> {
    if (!E2E_CONFIG.interactive.enabled) {
      console.log(`CI Mode: Skipping - ${message}`);
      return;
    }

    await prompts({
      type: 'confirm',
      name: 'continue',
      message,
      initial: true
    });
  }

  static async selectTestScenario(scenarios: string[]): Promise<string> {
    const response = await prompts({
      type: 'select',
      name: 'scenario',
      message: 'Select a test scenario:',
      choices: scenarios.map(s => ({ title: s, value: s }))
    });
    
    return response.scenario;
  }

  static displayTestResult(testName: string, passed: boolean, details?: string) {
    const status = passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`\n${status}: ${testName}`);
    
    if (details) {
      console.log(details);
    }
  }

  static displayGradingResult(scores: {
    queryUnderstanding: number;
    actionAccuracy: number;
    responseQuality: number;
    errorHandling: number;
    overall: number;
  }) {
    console.log('\n=== Grading Results ===');
    console.log(`Query Understanding: ${scores.queryUnderstanding}/100`);
    console.log(`Action Accuracy: ${scores.actionAccuracy}/100`);
    console.log(`Response Quality: ${scores.responseQuality}/100`);
    console.log(`Error Handling: ${scores.errorHandling}/100`);
    console.log(`\nOverall Score: ${scores.overall}/100`);
    
    if (scores.overall >= E2E_CONFIG.grading.excellentScore) {
      console.log('🌟 Excellent!');
    } else if (scores.overall >= E2E_CONFIG.grading.passingScore) {
      console.log('✅ Good');
    } else {
      console.log('❌ Needs Improvement');
    }
  }
}