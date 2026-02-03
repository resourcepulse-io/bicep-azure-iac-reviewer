import { analyzeResources, BackendCallContext } from '../../../src/backend/client';
import { SanitizedResource } from '../../../src/iac/sanitize';
import * as log from '../../../src/utils/log';

// Mock the log module
jest.mock('../../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('analyzeResources', () => {
  const mockResources: SanitizedResource[] = [
    {
      kind: 'vm',
      sku: 'Standard_D2s_v3',
      region: 'eastus',
      count: 1,
      change: 'modified',
      type: 'Microsoft.Compute/virtualMachines',
      apiVersion: '2023-01-01',
    },
    {
      kind: 'storage',
      region: 'westus',
      count: 1,
      change: 'added',
      type: 'Microsoft.Storage/storageAccounts',
      safeProperties: {
        replication: 'LRS',
      },
    },
    {
      kind: 'appservice',
      region: 'eastus',
      count: 1,
      change: 'modified',
      type: 'Microsoft.Web/sites',
    },
  ];

  const mockCallContext: BackendCallContext = {
    repo: {
      owner: 'test-owner',
      name: 'test-repo',
      fullName: 'test-owner/test-repo',
    },
    pr: {
      number: 42,
      title: 'Test PR',
      author: 'test-user',
      baseBranch: 'main',
    },
    run: {
      id: '12345',
      url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
    },
    context: {
      sha: 'abc123',
      ref: 'feature-branch',
    },
    resolvedRegions: ['eastus', 'westus'],
    unresolvedLocations: ["parameters('location')"],
    paramFileUsed: 'infra/params/dev.bicepparam',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    (global.fetch as jest.Mock).mockReset();
  });

  describe('Local Fallback Scenarios', () => {
    it('should use local fallback when no API key provided', async () => {
      const result = await analyzeResources(mockResources);

      expect(result.success).toBe(true);
      expect(result.source).toBe('local');
      expect(result.markdown).toContain('Azure Resource Analysis');
      expect(result.markdown).toContain('Detected **3** resource(s)');
      expect(result.markdown).toContain('Virtual Machines');
      expect(result.markdown).toContain('Storage Accounts');
      expect(result.markdown).toContain('App Services');
      expect(result.markdown).toContain('Want detailed cost estimates');
      expect(result.markdown).toContain('api_key');

      // Should not call fetch
      expect(global.fetch).not.toHaveBeenCalled();

      // Should log the fallback
      expect(log.info).toHaveBeenCalledWith(
        'No API key provided - using local fallback analysis'
      );
    });

    it('should use local fallback when no call context provided', async () => {
      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        // No callContext
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('local');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should format resource counts correctly by kind', async () => {
      const resources: SanitizedResource[] = [
        { kind: 'vm', count: 1, change: 'added', type: 'Microsoft.Compute/virtualMachines' },
        { kind: 'vm', count: 1, change: 'modified', type: 'Microsoft.Compute/virtualMachines' },
        { kind: 'storage', count: 1, change: 'added', type: 'Microsoft.Storage/storageAccounts' },
        { kind: 'appservice', count: 1, change: 'added', type: 'Microsoft.Web/serverfarms' },
        { kind: 'appservice', count: 1, change: 'modified', type: 'Microsoft.Web/serverfarms' },
        { kind: 'appservice', count: 1, change: 'added', type: 'Microsoft.Web/serverfarms' },
      ];

      const result = await analyzeResources(resources);

      expect(result.markdown).toContain('Detected **6** resource(s)');
      expect(result.markdown).toContain('App Services**: 3');
      expect(result.markdown).toContain('Virtual Machines**: 2');
      expect(result.markdown).toContain('Storage Accounts**: 1');
    });

    it('should handle empty resource array', async () => {
      const result = await analyzeResources([]);

      expect(result.success).toBe(true);
      expect(result.source).toBe('local');
      expect(result.markdown).toContain('Detected **0** resource(s)');
    });

    it('should include privacy notice in local fallback', async () => {
      const result = await analyzeResources(mockResources);

      expect(result.markdown).toContain('anonymized resource metadata only');
      expect(result.markdown).toContain(
        'no source code or identifiers are transmitted'
      );
    });
  });

  describe('Backend Success Scenarios', () => {
    it('should successfully call backend with API key and context', async () => {
      const mockMarkdown = '## Cost Analysis\n\nEstimated cost: $100/month';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: mockMarkdown }),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('backend');
      expect(result.markdown).toBe(mockMarkdown);

      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.resourcepulse.io/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
            'User-Agent': 'azure-iac-reviewer/1.0.0',
          }),
          body: expect.any(String),
        })
      );

      // Verify request payload structure
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.repo).toBeDefined();
      expect(requestBody.pr).toBeDefined();
      expect(requestBody.run).toBeDefined();
      expect(requestBody.context).toBeDefined();
      expect(requestBody.resources).toBeDefined();

      // Should log success
      expect(log.info).toHaveBeenCalledWith(
        'Backend analysis completed successfully'
      );
    });

    it('should use custom server address when provided', async () => {
      const mockMarkdown = '## Analysis';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: mockMarkdown }),
      });

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        serverAddress: 'https://custom.example.com',
        callContext: mockCallContext,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://custom.example.com/analyze',
        expect.any(Object)
      );
    });

    it('should handle backend response with message field instead of markdown', async () => {
      const mockMessage = 'Analysis complete: 3 resources analyzed';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, message: mockMessage }),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('backend');
      expect(result.markdown).toBe(mockMessage);
    });

    it('should include PR and repo info in request payload', async () => {
      const mockMarkdown = '## Analysis Result';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: mockMarkdown }),
      });

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.repo.fullName).toBe('test-owner/test-repo');
      expect(requestBody.pr.number).toBe(42);
      expect(requestBody.pr.title).toBe('Test PR');
      expect(requestBody.pr.author).toBe('test-user');
      expect(requestBody.context.sha).toBe('abc123');
      expect(requestBody.resolvedRegions).toEqual(['eastus', 'westus']);
      expect(requestBody.unresolvedLocations).toEqual(["parameters('location')"]);
      expect(requestBody.paramFileUsed).toBe('infra/params/dev.bicepparam');
    });

    it('should convert resources to API format (kind, region, sku, count, change)', async () => {
      const mockMarkdown = '## Analysis Result';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: mockMarkdown }),
      });

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Verify API resource format
      expect(requestBody.resources[0]).toEqual({
        kind: 'vm',
        region: 'eastus',
        sku: 'Standard_D2s_v3',
        count: 1,
        change: 'modified',
      });
    });
  });

  describe('Backend Response Handling', () => {
    it('should respect success=false from backend response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: false, error: 'Analysis failed' }),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.markdown).toContain('Azure Resource Analysis');
    });

    it('should fall back to local when backend returns 500 error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Database connection failed' }),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.markdown).toContain('Azure Resource Analysis');
      expect(result.error).toBeDefined();

      // Should log warning
      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Backend returned status 500')
      );
    });

    it('should fall back to local when backend returns 401 unauthorized', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'invalid-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.error).toBeDefined();

      // Should log warning
      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Backend returned status 401')
      );
    });

    it('should fall back to local when backend response is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.error).toBeDefined();
    });
  });

  describe('Network Error Handling', () => {
    it('should fall back to local on network timeout', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), {
          name: 'AbortError',
        })
      );

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.error).toContain('timed out');

      // Should log timeout warning
      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Backend request timed out after')
      );
    });

    it('should fall back to local on DNS resolution failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND api.example.com')
      );

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.error).toContain('Network error');

      // Should log network error
      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Network error calling backend')
      );
    });

    it('should handle unknown error types gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce('Unknown error');

      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(false);
      expect(result.source).toBe('local');
      expect(result.error).toBeDefined();

      // Should log generic warning
      expect(log.warning).toHaveBeenCalledWith('Unknown error calling backend');
    });
  });

  describe('Privacy Contract Enforcement', () => {
    it('should validate resources before sending to backend', async () => {
      const mockMarkdown = '## Analysis Result';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: mockMarkdown }),
      });

      // Clean resources should succeed
      const result = await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe('backend');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should refuse to send resources with sensitive data', async () => {
      // Create resources with forbidden fields (should fail validation)
      const sensitiveResources: SanitizedResource[] = [
        {
          kind: 'vm',
          count: 1,
          change: 'added',
          // @ts-expect-error - Testing privacy violation
          name: 'my-production-vm',
        },
      ];

      await expect(
        analyzeResources(sensitiveResources, {
          apiKey: 'test-api-key',
          callContext: mockCallContext,
        })
      ).rejects.toThrow('Privacy contract violation');

      // Should log error
      expect(log.error).toHaveBeenCalledWith(
        'Privacy contract violation detected - refusing to send data'
      );

      // Should NOT call fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should refuse to send resources with GUID patterns', async () => {
      const sensitiveResources: SanitizedResource[] = [
        {
          kind: 'vm',
          count: 1,
          change: 'added',
          safeProperties: {
            resourceGuid: '12345678-1234-1234-1234-123456789012',
          },
        },
      ];

      await expect(
        analyzeResources(sensitiveResources, {
          apiKey: 'test-api-key',
          callContext: mockCallContext,
        })
      ).rejects.toThrow('Privacy contract violation');

      // Should NOT call fetch
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single resource', async () => {
      const singleResource: SanitizedResource[] = [
        {
          kind: 'storage',
          count: 1,
          change: 'added',
          type: 'Microsoft.Storage/storageAccounts',
        },
      ];

      const result = await analyzeResources(singleResource);

      expect(result.success).toBe(true);
      expect(result.markdown).toContain('Detected **1** resource(s)');
      expect(result.markdown).toContain('Storage Accounts**: 1');
    });

    it('should handle resources with unknown kinds', async () => {
      const resources: SanitizedResource[] = [
        {
          kind: 'other',
          count: 1,
          change: 'added',
          type: 'Microsoft.CustomProvider/customResources',
        },
        {
          kind: 'unknown_kind',
          count: 1,
          change: 'modified',
          type: 'Microsoft.CustomProvider/anotherResource',
        },
      ];

      const result = await analyzeResources(resources);

      expect(result.success).toBe(true);
      expect(result.markdown).toContain('Other Resources');
      expect(result.markdown).toContain('UNKNOWN_KIND');
    });

    it('should handle empty string API key as no API key', async () => {
      const result = await analyzeResources(mockResources, { apiKey: '' });

      expect(result.success).toBe(true);
      expect(result.source).toBe('local');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Logging and Observability', () => {
    it('should log debug messages during backend call', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: '## Analysis' }),
      });

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(log.debug).toHaveBeenCalledWith('Starting resource analysis');
      expect(log.debug).toHaveBeenCalledWith(
        'Calling backend API: https://api.resourcepulse.io'
      );
      expect(log.debug).toHaveBeenCalledWith(
        'Sending 3 sanitized resource(s)'
      );
      expect(log.debug).toHaveBeenCalledWith(
        'Backend response received successfully'
      );
    });

    it('should log API key status', async () => {
      await analyzeResources(mockResources);

      expect(log.debug).toHaveBeenCalledWith('API key provided: no');
    });

    it('should log info message when using local fallback by choice', async () => {
      await analyzeResources(mockResources);

      expect(log.info).toHaveBeenCalledWith(
        'No API key provided - using local fallback analysis'
      );
    });

    it('should log warning when backend fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network failure')
      );

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(log.warning).toHaveBeenCalledWith(
        expect.stringContaining('Error calling backend')
      );
      expect(log.warning).toHaveBeenCalledWith(
        'Backend analysis failed - falling back to local summary'
      );
    });

    it('should log attempt to call backend', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, markdown: '## Analysis' }),
      });

      await analyzeResources(mockResources, {
        apiKey: 'test-api-key',
        callContext: mockCallContext,
      });

      expect(log.info).toHaveBeenCalledWith(
        'Attempting backend analysis at https://api.resourcepulse.io'
      );
    });
  });
});
