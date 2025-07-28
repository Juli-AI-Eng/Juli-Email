import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SetupManager } from '../../src/setup/setupManager';
import { SetupResponse } from '../../src/types';
import Nylas from 'nylas';

// Mock Nylas
jest.mock('nylas');

describe('SetupManager', () => {
  let setupManager: SetupManager;
  let mockNylas: jest.Mocked<Nylas>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    setupManager = new SetupManager();
  });

  describe('getInstructions', () => {
    it('should return detailed setup instructions', async () => {
      const result = await setupManager.getInstructions();

      expect(result.type).toBe('setup_instructions');
      expect(result.title).toBe('Email Setup Guide');
      expect(result.estimated_time).toBe('5 minutes');
      expect(result.steps).toHaveLength(3);
      expect(result.steps?.[0].title).toContain('Nylas Account');
      expect(result.steps?.[1].title).toContain('API Key');
      expect(result.steps?.[2].title).toContain('Connect Your Email');
    });

    it('should include action links and tips', async () => {
      const result = await setupManager.getInstructions();

      const firstStep = result.steps?.[0];
      expect(firstStep?.actions).toBeDefined();
      expect(firstStep?.actions?.[0].type).toBe('link');
      expect(firstStep?.actions?.[0].url).toContain('nylas.com');
      expect(firstStep?.tips).toContain('No credit card required for free tier');
    });
  });

  describe('validateCredentials', () => {
    it('should validate correct credentials', async () => {
      const credentials = {
        nylas_api_key: 'nyk_test123',
        nylas_grant_id: '12345678-1234-1234-1234-123456789012'
      };

      // Mock successful Nylas validation
      const mockGrant = {
        data: {
          email: 'test@example.com',
          provider: 'gmail'
        }
      };

      (Nylas as any).mockImplementation(() => ({
        grants: {
          find: jest.fn<any>().mockResolvedValue(mockGrant)
        }
      }));

      const result = await setupManager.validateCredentials(credentials);

      expect(result.type).toBe('setup_success');
      expect(result.message).toContain('Successfully connected test@example.com');
      expect(result.credentials_validated).toBe(true);
      expect(result.credentials_to_store).toEqual({
        nylas_api_key: credentials.nylas_api_key,
        nylas_grant_id: credentials.nylas_grant_id,
        email_address: 'test@example.com',
        provider: 'gmail'
      });
    });

    it('should handle missing credentials', async () => {
      const result = await setupManager.validateCredentials({});

      expect(result.type).toBe('validation_error');
      expect(result.message).toBe('Both API key and Grant ID are required');
      expect(result.missing_fields).toContain('nylas_api_key');
      expect(result.missing_fields).toContain('nylas_grant_id');
    });

    it('should handle invalid API key format', async () => {
      const credentials = {
        nylas_api_key: 'invalid_key',
        nylas_grant_id: '12345678-1234-1234-1234-123456789012'
      };

      const result = await setupManager.validateCredentials(credentials);

      expect(result.type).toBe('validation_error');
      expect(result.message).toContain('API key should start with \'nyk_\'');
    });

    it('should handle Nylas API errors', async () => {
      const credentials = {
        nylas_api_key: 'nyk_test123',
        nylas_grant_id: '12345678-1234-1234-1234-123456789012'
      };

      // Mock Nylas 401 error
      const error = new Error('Unauthorized') as any;
      error.statusCode = 401;

      (Nylas as any).mockImplementation(() => ({
        grants: {
          find: jest.fn<any>().mockRejectedValue(error)
        }
      }));

      const result = await setupManager.validateCredentials(credentials);

      expect(result.type).toBe('setup_error');
      expect(result.message).toBe('Invalid API key');
    });

    it('should handle grant not found error', async () => {
      const credentials = {
        nylas_api_key: 'nyk_test123',
        nylas_grant_id: '12345678-1234-1234-1234-123456789012'
      };

      // Mock Nylas 404 error
      const error = new Error('Not Found') as any;
      error.statusCode = 404;

      (Nylas as any).mockImplementation(() => ({
        grants: {
          find: jest.fn<any>().mockRejectedValue(error)
        }
      }));

      const result = await setupManager.validateCredentials(credentials);

      expect(result.type).toBe('setup_error');
      expect(result.message).toBe('Grant ID not found');
    });
  });

  describe('troubleshoot', () => {
    it('should provide troubleshooting for permission issues', async () => {
      const result = await setupManager.troubleshoot(
        'I\'m getting permission denied errors'
      );

      expect(result.type).toBe('setup_instructions');
      expect(result.title).toBe('Permission Issue Resolution');
      expect(result.steps?.[0].title).toContain('Re-authorize');
    });

    it('should provide troubleshooting for expired grants', async () => {
      const result = await setupManager.troubleshoot(
        'My grant seems to be expired'
      );

      expect(result.type).toBe('setup_instructions');
      expect(result.title).toBe('Grant Expired - Create New Grant');
      expect(result.steps?.[0].description).toContain('expire after 30 days');
    });

    it('should provide generic troubleshooting for unknown issues', async () => {
      const result = await setupManager.troubleshoot(
        'Something is not working'
      );

      expect(result.type).toBe('setup_instructions');
      expect(result.title).toBe('General Troubleshooting');
      expect(result.steps).toHaveLength(4);
    });
  });
});