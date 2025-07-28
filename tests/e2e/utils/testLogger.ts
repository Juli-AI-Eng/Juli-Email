/**
 * Enhanced logger for E2E tests with comprehensive output formatting
 */

import { E2E_CONFIG } from './config';
import * as fs from 'fs';
import * as path from 'path';

export class TestLogger {
  private startTime: number = Date.now();
  private operationTimings: Map<string, number> = new Map();
  private responseDir: string;
  
  constructor() {
    // Create directory for saving responses if enabled
    if (E2E_CONFIG.logging.saveResponses) {
      this.responseDir = path.join(process.cwd(), 'test-responses', new Date().toISOString().split('T')[0]);
      if (!fs.existsSync(this.responseDir)) {
        fs.mkdirSync(this.responseDir, { recursive: true });
      }
    }
  }
  
  /**
   * Log a section header
   */
  logSection(title: string) {
    const width = 60;
    const padding = Math.max(0, width - title.length - 2);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    
    console.log('\n' + '═'.repeat(width));
    console.log('═' + ' '.repeat(leftPad) + title + ' '.repeat(rightPad) + '═');
    console.log('═'.repeat(width) + '\n');
  }
  
  /**
   * Log a numbered step
   */
  logStep(step: number, description: string) {
    console.log(`\n📍 Step ${step}: ${description}`);
    if (E2E_CONFIG.logging.logTimings) {
      this.startOperation(`step_${step}`);
    }
  }
  
  /**
   * Log an API call
   */
  logApiCall(method: string, endpoint: string, data?: any) {
    if (!E2E_CONFIG.logging.logApiCalls) return;
    
    console.log(`\n🔄 API Call: ${method} ${endpoint}`);
    if (data && E2E_CONFIG.logging.verbose) {
      console.log('📤 Request Data:');
      this.logData('', data, 2);
    }
  }
  
  /**
   * Log an API response
   */
  logApiResponse(status: number, data: any, endpoint?: string) {
    if (!E2E_CONFIG.logging.logApiCalls) return;
    
    const statusEmoji = status >= 200 && status < 300 ? '✅' : '❌';
    console.log(`\n${statusEmoji} API Response: ${status}`);
    
    if (E2E_CONFIG.logging.verbose && data) {
      console.log('📥 Response Data:');
      this.logData('', data, 2);
    }
    
    // Save response to file if enabled
    if (E2E_CONFIG.logging.saveResponses && endpoint) {
      const filename = `${Date.now()}_${endpoint.replace(/\//g, '_')}.json`;
      const filepath = path.join(this.responseDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
      console.log(`💾 Response saved to: ${filepath}`);
    }
  }
  
  /**
   * Log a success message
   */
  logSuccess(message: string) {
    console.log(`\n✅ ${message}`);
  }
  
  /**
   * Log an error message
   */
  logError(message: string, error?: any) {
    console.log(`\n❌ ${message}`);
    if (error) {
      console.error('Error details:', JSON.stringify(error, null, 2));
    }
  }
  
  /**
   * Log a warning message
   */
  logWarning(message: string) {
    console.log(`\n⚠️  ${message}`);
  }
  
  /**
   * Log an info message
   */
  logInfo(message: string) {
    console.log(`\nℹ️  ${message}`);
  }
  
  /**
   * Log data with pretty formatting
   */
  logData(label: string, data: any, indent: number = 0) {
    const prefix = ' '.repeat(indent);
    
    if (label) {
      console.log(`${prefix}📊 ${label}:`);
    }
    
    if (typeof data === 'object' && data !== null) {
      const formatted = JSON.stringify(data, null, 2)
        .split('\n')
        .map(line => prefix + '  ' + line)
        .join('\n');
      console.log(formatted);
    } else {
      console.log(`${prefix}  ${data}`);
    }
  }
  
  /**
   * Start timing an operation
   */
  startOperation(operationName: string) {
    if (E2E_CONFIG.logging.logTimings) {
      this.operationTimings.set(operationName, Date.now());
    }
  }
  
  /**
   * End timing an operation and log the duration
   */
  endOperation(operationName: string) {
    if (!E2E_CONFIG.logging.logTimings) return;
    
    const startTime = this.operationTimings.get(operationName);
    if (startTime) {
      const duration = Date.now() - startTime;
      console.log(`⏱️  ${operationName} took ${duration}ms`);
      this.operationTimings.delete(operationName);
    }
  }
  
  /**
   * Log timing for an async operation
   */
  async timeOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    this.startOperation(operationName);
    try {
      const result = await operation();
      this.endOperation(operationName);
      return result;
    } catch (error) {
      this.endOperation(operationName);
      throw error;
    }
  }
  
  /**
   * Log test summary
   */
  logTestSummary(passed: number, failed: number, skipped: number = 0) {
    const total = passed + failed + skipped;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    this.logSection('TEST SUMMARY');
    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    if (failed > 0) console.log(`❌ Failed: ${failed}`);
    if (skipped > 0) console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`\n⏱️  Total Duration: ${duration}s`);
    
    if (this.responseDir) {
      console.log(`\n💾 Responses saved to: ${this.responseDir}`);
    }
  }
  
  /**
   * Create a sub-logger for nested operations
   */
  createSubLogger(prefix: string): SubLogger {
    return new SubLogger(this, prefix);
  }
}

/**
 * Sub-logger for nested operations
 */
class SubLogger {
  constructor(private parent: TestLogger, private prefix: string) {}
  
  log(message: string) {
    console.log(`  ${this.prefix}: ${message}`);
  }
  
  logData(label: string, data: any) {
    this.parent.logData(`${this.prefix} - ${label}`, data, 2);
  }
}

// Export a singleton instance for convenience
export const logger = new TestLogger();