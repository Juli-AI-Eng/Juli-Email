/**
 * HTTP client for E2E testing of the Inbox MCP server
 * Replaces the stdio-based MCP client with HTTP communication
 */

import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { logger } from './testLogger';
import * as fs from 'fs';
import * as path from 'path';

export interface HttpClientConfig {
  baseUrl: string;
  port: number;
  credentials?: {
    nylasGrantId?: string;
  };
  devAgentSecret?: string;
}

export interface ToolCallResponse {
  success: boolean;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  needs_approval?: boolean;
  action_type?: string;
  action_data?: any;
  preview?: any;
}

export class HttpTestClient {
  private client: AxiosInstance;
  private credentials?: {
    nylasGrantId?: string;
  };
  private devAgentSecret?: string;

  constructor(config: HttpClientConfig) {
    this.credentials = config.credentials;
    this.devAgentSecret = config.devAgentSecret ?? process.env.A2A_DEV_SHARED_SECRET ?? 'test-secret';
    this.client = axios.create({
      baseURL: `${config.baseUrl}:${config.port}`,
      timeout: 60000, // 60 seconds for AI operations
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request/response interceptors for logging
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Create log file for HTTP traffic
    const logDir = path.join(process.cwd(), 'tests', 'e2e', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `http-traffic-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

    const appendToLog = (content: string) => {
      fs.appendFileSync(logFile, content + '\n');
    };

    // Log file location
    console.log(`\n📝 HTTP traffic log: ${logFile}\n`);

    let requestCounter = 0;

    // Request interceptor
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const method = config.method?.toUpperCase() || 'GET';
        const url = config.url || '';
        const requestId = ++requestCounter;
        const timestamp = new Date().toISOString();

        // Build request log
        let requestLog = `\n========== REQUEST #${requestId} ==========\n`;
        requestLog += `Timestamp: ${timestamp}\n`;
        requestLog += `${method} ${config.baseURL}${url} HTTP/1.1\n`;

        Object.entries(config.headers as any).forEach(([key, value]) => {
          requestLog += `${key}: ${value}\n`;
        });

        if (config.data) {
          requestLog += '\n' + JSON.stringify(config.data, null, 2) + '\n';
        }
        requestLog += '==================================\n';

        // Log to console (abbreviated)
        console.log(`\n--- HTTP REQUEST #${requestId} ---`);
        console.log(`${method} ${config.baseURL}${url}`);
        if (config.data) {
          console.log('Body:', JSON.stringify(config.data).substring(0, 100) + '...');
        }

        // Log to file (full)
        appendToLog(requestLog);

        // Add request ID for response matching
        (config as any).requestId = requestId;

        // Log the request
        logger.logApiCall(method, url, config.data);

        return config;
      },
      (error) => {
        logger.logError('Request failed', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        const requestId = (response.config as any).requestId || 'unknown';
        const timestamp = new Date().toISOString();

        // Build response log
        let responseLog = `\n========== RESPONSE #${requestId} ==========\n`;
        responseLog += `Timestamp: ${timestamp}\n`;
        responseLog += `HTTP/1.1 ${response.status} ${response.statusText}\n`;

        Object.entries(response.headers).forEach(([key, value]) => {
          responseLog += `${key}: ${value}\n`;
        });

        responseLog += '\n' + JSON.stringify(response.data, null, 2) + '\n';
        responseLog += '===================================\n';

        // Log to console (abbreviated)
        console.log(`\n--- HTTP RESPONSE #${requestId} ---`);
        console.log(`Status: ${response.status}`);
        if (response.data?.needs_approval) {
          console.log('Needs Approval:', response.data.needs_approval);
          console.log('Action Type:', response.data.action_type);
        } else {
          console.log('Body:', JSON.stringify(response.data).substring(0, 100) + '...');
        }

        // Log to file (full)
        appendToLog(responseLog);

        logger.logApiResponse(response.status, response.data, response.config.url);
        return response;
      },
      (error) => {
        const requestId = (error.config as any)?.requestId || 'unknown';
        const timestamp = new Date().toISOString();

        if (error.response) {
          // Build error response log
          let errorLog = `\n========== ERROR RESPONSE #${requestId} ==========\n`;
          errorLog += `Timestamp: ${timestamp}\n`;
          errorLog += `HTTP/1.1 ${error.response.status} ${error.response.statusText}\n`;

          Object.entries(error.response.headers).forEach(([key, value]) => {
            errorLog += `${key}: ${value}\n`;
          });

          errorLog += '\n' + JSON.stringify(error.response.data, null, 2) + '\n';
          errorLog += '======================================\n';

          // Log to console (abbreviated)
          console.log(`\n--- HTTP ERROR #${requestId} ---`);
          console.log(`Status: ${error.response.status}`);
          console.log('Error:', JSON.stringify(error.response.data).substring(0, 100) + '...');

          // Log to file (full)
          appendToLog(errorLog);

          logger.logApiResponse(error.response.status, error.response.data, error.config?.url);
        } else {
          logger.logError('Response error', error);
        }
        return Promise.reject(error);
      }
    );
  }

  async listTools(): Promise<any> {
    const headers = this.getCredentialHeaders();
    try {
      // Use A2A Agent Card discovery
      const response = await this.client.get('/.well-known/a2a.json', { headers });
      const card = response.data || {};
      const tools = Array.isArray(card.capabilities)
        ? card.capabilities.map((c: any) => ({ name: c.name, description: c.description }))
        : [];
      return { tools };
    } catch (error: any) {
      if (error.response) {
        return error.response.data;
      }
      throw error;
    }
  }

  async callTool(toolName: string, args: any): Promise<ToolCallResponse> {
    // JSON-RPC wrapper for A2A
    const headers = this.getCredentialHeaders();
    const id = Date.now().toString();
    const payload = {
      jsonrpc: '2.0',
      id,
      method: 'tool.execute',
      params: {
        tool: toolName,
        arguments: args,
        user_context: {
          credentials: {
            EMAIL_ACCOUNT_GRANT: this.credentials?.nylasGrantId
          }
        },
        request_id: id
      }
    };
    try {
      const response = await this.client.post(`/a2a/rpc`, payload, { headers });
      const data = response.data;
      if (data?.error) return data;
      return data?.result || data;
    } catch (error: any) {
      if (error.response) {
        return error.response.data;
      }
      throw error;
    }
  }

  // Generic JSON-RPC caller for flexibility in tests
  async callRpc(method: string, params: any = {}, id: string | number = Date.now()): Promise<any> {
    const headers = this.getCredentialHeaders();
    const payload = { jsonrpc: '2.0', id, method, params };
    try {
      const response = await this.client.post('/a2a/rpc', payload, { headers });
      return response.data;
    } catch (error: any) {
      if (error.response) return error.response.data;
      throw error;
    }
  }

  // Batch JSON-RPC call helper
  async callBatch(requests: any[]): Promise<any> {
    const headers = this.getCredentialHeaders();
    const response = await this.client.post('/a2a/rpc', requests, { headers });
    return response.data;
  }

  // Raw batch call returning status and data (for notification-only 204 cases)
  async callBatchRaw(requests: any[]): Promise<{ status: number; data: any }> {
    const headers = this.getCredentialHeaders();
    const response = await this.client.post('/a2a/rpc', requests, { headers });
    return { status: response.status, data: response.data };
  }

  private getCredentialHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.credentials?.nylasGrantId) {
      headers['X-User-Credential-NYLAS_GRANT_ID'] = this.credentials.nylasGrantId;
    }

    if (this.devAgentSecret) {
      headers['X-A2A-Dev-Secret'] = this.devAgentSecret;
    }

    return headers;
  }

  // Update credentials for testing different user scenarios
  updateCredentials(credentials: HttpClientConfig['credentials']) {
    this.credentials = credentials;
  }

  // Helper method to simulate approval flow
  async approveAction(toolName: string, originalArgs: any, actionData: any): Promise<ToolCallResponse> {
    return this.callTool(toolName, {
      ...originalArgs,
      approved: true,
      action_data: actionData
    });
  }

  // Generic GET method
  async get(path: string): Promise<any> {
    const headers = this.getCredentialHeaders();
    try {
      const response = await this.client.get(path, { headers });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        return error.response.data;
      }
      throw error;
    }
  }

  // Generic POST method
  async post(path: string, data: any = {}): Promise<any> {
    const headers = this.getCredentialHeaders();
    try {
      const response = await this.client.post(path, data, { headers });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        return error.response.data;
      }
      throw error;
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

// Helper to start the server for testing
export async function startTestServer(): Promise<{ port: number; stop: () => Promise<void> }> {
  const { spawn } = require('child_process');
  const port = 3000 + Math.floor(Math.random() * 1000); // Random port to avoid conflicts

  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: port.toString(), A2A_DEV_SHARED_SECRET: process.env.A2A_DEV_SHARED_SECRET || 'test-secret' };
    // Run from TypeScript source to ensure tests use latest code
    const serverProcess = spawn('npm', ['run', 'dev'], { env });

    let started = false;

    serverProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      if (process.env.VERBOSE === 'true') {
        console.log('[Server]', output.trim());
      }
      if (output.includes('Inbox MCP HTTP server running') && !started) {
        started = true;
        resolve({
          port,
          stop: async () => {
            serverProcess.kill();
            await new Promise(r => setTimeout(r, 500)); // Wait for cleanup
          }
        });
      }
    });

    serverProcess.stderr.on('data', (data: Buffer) => {
      const error = data.toString();

      // Ignore deprecation warnings
      if (error.includes('DeprecationWarning') || error.includes('DEP0040')) {
        if (process.env.VERBOSE === 'true') {
          console.log('[Server Warning]', error.trim());
        }
        return;
      }

      if (process.env.VERBOSE === 'true' || !started) {
        console.error('[Server Error]', error.trim());
      }

      // Only reject for actual errors, not warnings
      if (!started && !error.includes('Warning')) {
        reject(new Error(`Server failed to start: ${error}`));
      }
    });

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error('Server failed to start within timeout'));
      }
    }, 10000);
  });
}

// Create a test client with proper configuration
export function createTestClient(config?: Partial<HttpClientConfig>): HttpTestClient {
  return new HttpTestClient({
    baseUrl: 'http://localhost',
    port: 3000,
    ...config
  });
}