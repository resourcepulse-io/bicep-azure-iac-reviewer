import * as fs from 'fs';
import * as https from 'https';
import {
  ensureBicepCli,
  compileBicepFile,
  compileBicepFiles,
  formatCompilationErrors,
} from '../../../src/iac/bicep';
import * as exec from '../../../src/utils/exec';

// Mock dependencies
jest.mock('fs');
jest.mock('https');
jest.mock('../../../src/utils/exec');
jest.mock('../../../src/utils/log', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockHttps = https as jest.Mocked<typeof https>;
const mockExec = exec as jest.Mocked<typeof exec>;

describe('Bicep Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('ensureBicepCli', () => {
    it('should throw error if RUNNER_TEMP is not set', async () => {
      delete process.env.RUNNER_TEMP;

      await expect(ensureBicepCli()).rejects.toThrow(
        'RUNNER_TEMP environment variable not set'
      );
    });

    it('should return cached binary path if it exists (Windows)', async () => {
      process.env.RUNNER_TEMP = 'C:\\temp';
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockFs.existsSync.mockReturnValue(true);

      const result = await ensureBicepCli();

      expect(result).toContain('bicep.exe');
      expect(mockHttps.get).not.toHaveBeenCalled();
    });

    it('should return cached binary path if it exists (Linux)', async () => {
      process.env.RUNNER_TEMP = '/tmp';
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockFs.existsSync.mockReturnValue(true);

      const result = await ensureBicepCli();

      expect(result).toContain('bicep');
      expect(result).toContain('tmp');
      expect(mockHttps.get).not.toHaveBeenCalled();
    });

    it('should download binary if not cached (Windows)', async () => {
      process.env.RUNNER_TEMP = 'C:\\temp';
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockFs.existsSync.mockReturnValue(false);

      // Mock file write stream
      const mockWriteStream = {
        close: jest.fn(),
        on: jest.fn(),
      };
      mockFs.createWriteStream.mockReturnValue(mockWriteStream as never);

      // Mock HTTPS download
      const mockResponse = {
        statusCode: 200,
        pipe: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation(((
        _url: string,
        callback: (response: typeof mockResponse) => void
      ) => {
        callback(mockResponse);
        // Simulate successful download
        setTimeout(() => {
          const finishHandler = mockWriteStream.on.mock.calls.find(
            (call) => call[0] === 'finish'
          )?.[1];
          if (finishHandler) finishHandler();
        }, 0);
        return { on: jest.fn() };
      }) as never);

      const result = await ensureBicepCli();

      expect(result).toContain('bicep.exe');
      expect(mockHttps.get).toHaveBeenCalled();
      expect(mockFs.createWriteStream).toHaveBeenCalled();
    });

    it('should make binary executable on Unix platforms', async () => {
      process.env.RUNNER_TEMP = '/tmp';
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockFs.existsSync.mockReturnValue(false);

      // Mock file write stream
      const mockWriteStream = {
        close: jest.fn(),
        on: jest.fn(),
      };
      mockFs.createWriteStream.mockReturnValue(mockWriteStream as never);

      // Mock HTTPS download
      const mockResponse = {
        statusCode: 200,
        pipe: jest.fn().mockReturnThis(),
      };

      mockHttps.get.mockImplementation(((
        _url: string,
        callback: (response: typeof mockResponse) => void
      ) => {
        callback(mockResponse);
        setTimeout(() => {
          const finishHandler = mockWriteStream.on.mock.calls.find(
            (call) => call[0] === 'finish'
          )?.[1];
          if (finishHandler) finishHandler();
        }, 0);
        return { on: jest.fn() };
      }) as never);

      await ensureBicepCli();

      expect(mockFs.chmodSync).toHaveBeenCalledWith(
        expect.stringContaining('bicep'),
        0o755
      );
    });

    it('should handle download failure', async () => {
      process.env.RUNNER_TEMP = '/tmp';
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockFs.existsSync.mockReturnValue(false);

      // Mock file write stream
      const mockWriteStream = {
        close: jest.fn(),
        on: jest.fn(),
      };
      mockFs.createWriteStream.mockReturnValue(mockWriteStream as never);

      // Mock HTTPS error
      mockHttps.get.mockImplementation(((_url: string, _callback: unknown) => {
        return {
          on: jest.fn((event: string, handler: (error: Error) => void) => {
            if (event === 'error') {
              handler(new Error('Network error'));
            }
          }),
        };
      }) as never);

      await expect(ensureBicepCli()).rejects.toThrow(
        'Failed to download Bicep CLI'
      );
    });

    it('should handle HTTP error status codes', async () => {
      process.env.RUNNER_TEMP = '/tmp';
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockFs.existsSync.mockReturnValue(false);

      // Mock file write stream
      const mockWriteStream = {
        close: jest.fn(),
        on: jest.fn(),
      };
      mockFs.createWriteStream.mockReturnValue(mockWriteStream as never);

      // Mock HTTPS 404 response
      const mockResponse = {
        statusCode: 404,
        statusMessage: 'Not Found',
      };

      mockHttps.get.mockImplementation(((
        _url: string,
        callback: (response: typeof mockResponse) => void
      ) => {
        callback(mockResponse);
        return { on: jest.fn() };
      }) as never);

      await expect(ensureBicepCli()).rejects.toThrow(
        'Failed to download Bicep CLI'
      );
    });

    it('should follow redirects', async () => {
      process.env.RUNNER_TEMP = '/tmp';
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockFs.existsSync.mockReturnValue(false);

      // Mock file write stream
      const mockWriteStream = {
        close: jest.fn(),
        on: jest.fn(),
      };
      mockFs.createWriteStream.mockReturnValue(mockWriteStream as never);

      let callCount = 0;

      // Mock HTTPS redirect then success
      mockHttps.get.mockImplementation(((
        _url: string,
        callback: (response: { statusCode: number; headers?: { location: string }; pipe?: () => void }) => void
      ) => {
        callCount++;
        if (callCount === 1) {
          // First call: redirect
          callback({
            statusCode: 302,
            headers: { location: 'https://redirected-url.com/bicep' },
          });
        } else {
          // Second call: success
          callback({
            statusCode: 200,
            pipe: jest.fn(),
          });
          setTimeout(() => {
            const finishHandler = mockWriteStream.on.mock.calls.find(
              (call) => call[0] === 'finish'
            )?.[1];
            if (finishHandler) finishHandler();
          }, 0);
        }
        return { on: jest.fn() };
      }) as never);

      const result = await ensureBicepCli();

      expect(result).toContain('bicep');
      expect(result).toContain('tmp');
      expect(mockHttps.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('compileBicepFile', () => {
    const bicepCliPath = '/usr/local/bin/bicep';
    const filePath = 'main.bicep';

    it('should successfully compile a Bicep file', async () => {
      const mockArmTemplate = {
        $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [],
      };

      mockExec.executeCommand.mockResolvedValue({
        stdout: JSON.stringify(mockArmTemplate),
        stderr: '',
        exitCode: 0,
      });

      const result = await compileBicepFile(bicepCliPath, filePath);

      expect(result).toEqual({
        filePath,
        success: true,
        armTemplate: mockArmTemplate,
      });

      expect(mockExec.executeCommand).toHaveBeenCalledWith(
        bicepCliPath,
        ['build', filePath, '--stdout']
      );
    });

    it('should handle compilation errors (non-zero exit code)', async () => {
      mockExec.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Error: Syntax error in main.bicep',
        exitCode: 1,
      });

      const result = await compileBicepFile(bicepCliPath, filePath);

      expect(result).toEqual({
        filePath,
        success: false,
        error: 'Error: Syntax error in main.bicep',
      });
    });

    it('should succeed with warnings when stderr has output but exit code is 0', async () => {
      mockExec.executeCommand.mockResolvedValue({
        stdout: '{}',
        stderr: 'Warning: Resource type deprecated',
        exitCode: 0,
      });

      const result = await compileBicepFile(bicepCliPath, filePath);

      expect(result).toEqual({
        filePath,
        success: true,
        armTemplate: {},
      });
    });

    it('should handle invalid JSON output', async () => {
      mockExec.executeCommand.mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
        exitCode: 0,
      });

      const result = await compileBicepFile(bicepCliPath, filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse ARM template');
    });

    it('should handle execution exceptions', async () => {
      mockExec.executeCommand.mockRejectedValue(
        new Error('Command execution failed')
      );

      const result = await compileBicepFile(bicepCliPath, filePath);

      expect(result).toEqual({
        filePath,
        success: false,
        error: 'Command execution failed',
      });
    });
  });

  describe('compileBicepFiles', () => {
    const bicepCliPath = '/usr/local/bin/bicep';

    it('should compile multiple files successfully', async () => {
      const mockArmTemplate = {
        $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [],
      };

      mockExec.executeCommand.mockResolvedValue({
        stdout: JSON.stringify(mockArmTemplate),
        stderr: '',
        exitCode: 0,
      });

      const filePaths = ['main.bicep', 'modules/storage.bicep'];
      const results = await compileBicepFiles(bicepCliPath, filePaths);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockExec.executeCommand).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed success and failure', async () => {
      mockExec.executeCommand
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ resources: [] }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'Compilation error',
          exitCode: 1,
        });

      const filePaths = ['main.bicep', 'broken.bicep'];
      const results = await compileBicepFiles(bicepCliPath, filePaths);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Compilation error');
    });

    it('should handle empty file list', async () => {
      const results = await compileBicepFiles(bicepCliPath, []);

      expect(results).toHaveLength(0);
      expect(mockExec.executeCommand).not.toHaveBeenCalled();
    });
  });

  describe('formatCompilationErrors', () => {
    it('should return null if no errors', () => {
      const results = [
        {
          filePath: 'main.bicep',
          success: true,
          armTemplate: {},
        },
      ];

      const formatted = formatCompilationErrors(results);

      expect(formatted).toBeNull();
    });

    it('should format single compilation error', () => {
      const results = [
        {
          filePath: 'main.bicep',
          success: false,
          error: 'Syntax error on line 5',
        },
      ];

      const formatted = formatCompilationErrors(results);

      expect(formatted).toContain('## Bicep Compilation Errors');
      expect(formatted).toContain('Found 1 file(s) with compilation errors');
      expect(formatted).toContain('### `main.bicep`');
      expect(formatted).toContain('Syntax error on line 5');
    });

    it('should format multiple compilation errors', () => {
      const results = [
        {
          filePath: 'main.bicep',
          success: false,
          error: 'Error in main.bicep',
        },
        {
          filePath: 'storage.bicep',
          success: false,
          error: 'Error in storage.bicep',
        },
      ];

      const formatted = formatCompilationErrors(results);

      expect(formatted).toContain('Found 2 file(s) with compilation errors');
      expect(formatted).toContain('### `main.bicep`');
      expect(formatted).toContain('Error in main.bicep');
      expect(formatted).toContain('### `storage.bicep`');
      expect(formatted).toContain('Error in storage.bicep');
    });

    it('should handle mixed success and failure', () => {
      const results = [
        {
          filePath: 'main.bicep',
          success: true,
          armTemplate: {},
        },
        {
          filePath: 'broken.bicep',
          success: false,
          error: 'Compilation failed',
        },
      ];

      const formatted = formatCompilationErrors(results);

      expect(formatted).toContain('Found 1 file(s) with compilation errors');
      expect(formatted).toContain('### `broken.bicep`');
      expect(formatted).not.toContain('main.bicep');
    });

    it('should handle missing error message', () => {
      const results = [
        {
          filePath: 'main.bicep',
          success: false,
        },
      ];

      const formatted = formatCompilationErrors(results);

      expect(formatted).toContain('Unknown error');
    });
  });
});
