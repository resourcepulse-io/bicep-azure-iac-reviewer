import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as log from '../utils/log';
import { executeCommand } from '../utils/exec';

/**
 * Pinned Bicep CLI version for reproducibility
 */
const BICEP_VERSION = 'v0.24.24';

/**
 * Result of compiling a single Bicep file
 */
export interface BicepCompilationResult {
  filePath: string;
  success: boolean;
  armTemplate?: Record<string, unknown>; // ARM JSON template
  error?: string; // Compilation error message
}

/**
 * Get the platform-specific Bicep CLI binary name and download URL
 * @returns Object with binary name and download URL
 */
function getBicepPlatformInfo(): { binaryName: string; downloadUrl: string } {
  const platform = process.platform;
  const arch = process.arch;

  let binaryName: string;
  let downloadUrl: string;

  if (platform === 'win32') {
    binaryName = 'bicep.exe';
    downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-win-x64.exe`;
  } else if (platform === 'darwin') {
    // macOS - check architecture
    if (arch === 'arm64') {
      binaryName = 'bicep';
      downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-osx-arm64`;
    } else {
      binaryName = 'bicep';
      downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-osx-x64`;
    }
  } else if (platform === 'linux') {
    // Linux - check architecture
    if (arch === 'arm64') {
      binaryName = 'bicep';
      downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-linux-arm64`;
    } else if (arch === 'arm') {
      binaryName = 'bicep';
      downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-linux-arm`;
    } else {
      binaryName = 'bicep';
      downloadUrl = `https://github.com/Azure/bicep/releases/download/${BICEP_VERSION}/bicep-linux-x64`;
    }
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { binaryName, downloadUrl };
}

/**
 * Download a file from a URL
 * @param url - URL to download from
 * @param destPath - Destination file path
 * @returns Promise that resolves when download is complete
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    https
      .get(url, (response) => {
        // Follow redirects
        if (
          response.statusCode === 301 ||
          response.statusCode === 302 ||
          response.statusCode === 307 ||
          response.statusCode === 308
        ) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect response missing location header'));
            return;
          }
          file.close();
          fs.unlinkSync(destPath);
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download file: HTTP ${response.statusCode} ${response.statusMessage}`
            )
          );
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });

    file.on('error', (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

/**
 * Download and cache the Bicep CLI binary
 * @returns Path to the Bicep CLI binary
 * @throws Error if download fails or RUNNER_TEMP is not set
 */
export async function ensureBicepCli(): Promise<string> {
  const runnerTemp = process.env.RUNNER_TEMP;

  if (!runnerTemp) {
    throw new Error(
      'RUNNER_TEMP environment variable not set. This action must run in a GitHub Actions environment.'
    );
  }

  const { binaryName, downloadUrl } = getBicepPlatformInfo();
  const bicepPath = path.join(runnerTemp, binaryName);

  // Check if binary already exists (cached from previous run)
  if (fs.existsSync(bicepPath)) {
    log.info(
      `Bicep CLI already cached at ${bicepPath}, skipping download (version: ${BICEP_VERSION})`
    );
    return bicepPath;
  }

  log.info(
    `Downloading Bicep CLI ${BICEP_VERSION} from ${downloadUrl} to ${bicepPath}`
  );

  try {
    await downloadFile(downloadUrl, bicepPath);

    // Make binary executable on Unix-like systems
    if (process.platform !== 'win32') {
      fs.chmodSync(bicepPath, 0o755);
    }

    log.info('Bicep CLI downloaded and ready');

    return bicepPath;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download Bicep CLI: ${errorMessage}`);
  }
}

/**
 * Compile a single Bicep file to ARM JSON
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param filePath - Path to the .bicep file to compile
 * @returns Compilation result with ARM template or error
 */
export async function compileBicepFile(
  bicepCliPath: string,
  filePath: string
): Promise<BicepCompilationResult> {
  log.info(`Compiling ${filePath}`);

  try {
    const result = await executeCommand(bicepCliPath, [
      'build',
      filePath,
      '--stdout',
    ]);

    // Check for compilation errors (non-zero exit code)
    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || 'Unknown compilation error';
      log.warning(`Compilation failed for ${filePath}: ${errorMessage}`);

      return {
        filePath,
        success: false,
        error: errorMessage,
      };
    }

    // Log stderr warnings (linter advisories) without failing
    if (result.stderr) {
      log.warning(`Compilation warnings for ${filePath}: ${result.stderr}`);
    }

    // Parse ARM JSON from stdout
    try {
      const armTemplate = JSON.parse(result.stdout) as Record<string, unknown>;

      log.info(`Successfully compiled ${filePath}`);

      return {
        filePath,
        success: true,
        armTemplate,
      };
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      log.warning(`Failed to parse ARM JSON for ${filePath}: ${errorMessage}`);

      return {
        filePath,
        success: false,
        error: `Failed to parse ARM template: ${errorMessage}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warning(`Failed to compile ${filePath}: ${errorMessage}`);

    return {
      filePath,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Compile multiple Bicep files
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param filePaths - Array of .bicep file paths to compile
 * @returns Array of compilation results (both successes and failures)
 */
export async function compileBicepFiles(
  bicepCliPath: string,
  filePaths: string[]
): Promise<BicepCompilationResult[]> {
  log.info(`Compiling ${filePaths.length} Bicep file(s)`);

  const results: BicepCompilationResult[] = [];

  // Compile files sequentially to avoid overwhelming the system
  for (const filePath of filePaths) {
    const result = await compileBicepFile(bicepCliPath, filePath);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  log.info(
    `Compilation complete: ${successCount} succeeded, ${failureCount} failed`
  );

  return results;
}

/**
 * Compile Bicep content from a string by writing to a temp file
 * Used for compiling base branch content fetched from GitHub API
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param content - Bicep file content as string
 * @param originalFilePath - Original file path (used for naming and logging)
 * @returns Compilation result with ARM template or error
 */
export async function compileBicepContent(
  bicepCliPath: string,
  content: string,
  originalFilePath: string
): Promise<BicepCompilationResult> {
  const runnerTemp = process.env.RUNNER_TEMP;

  if (!runnerTemp) {
    return {
      filePath: originalFilePath,
      success: false,
      error: 'RUNNER_TEMP environment variable not set',
    };
  }

  // Create a unique temp file name based on original path
  const sanitizedName = path.basename(originalFilePath).replace(/[^a-zA-Z0-9.-]/g, '_');
  const tempFileName = `base_${Date.now()}_${sanitizedName}`;
  const tempFilePath = path.join(runnerTemp, tempFileName);

  try {
    // Write content to temp file
    fs.writeFileSync(tempFilePath, content, 'utf-8');
    log.debug(`Wrote base content to temp file: ${tempFilePath}`);

    // Compile the temp file
    const result = await compileBicepFile(bicepCliPath, tempFilePath);

    // Return result with original file path for clearer logging
    return {
      ...result,
      filePath: originalFilePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      filePath: originalFilePath,
      success: false,
      error: `Failed to compile base content: ${errorMessage}`,
    };
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        log.debug(`Cleaned up temp file: ${tempFilePath}`);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Format compilation errors for PR comment
 * @param results - Array of compilation results
 * @returns Markdown-formatted error message, or null if no errors
 */
export function formatCompilationErrors(
  results: BicepCompilationResult[]
): string | null {
  const failures = results.filter((r) => !r.success);

  if (failures.length === 0) {
    return null;
  }

  const lines: string[] = [
    '## Bicep Compilation Errors',
    '',
    `Found ${failures.length} file(s) with compilation errors:`,
    '',
  ];

  for (const failure of failures) {
    const errorMessage = failure.error || 'Unknown error';
    const isLongError = errorMessage.length > 500;

    lines.push(`### \`${failure.filePath}\``);
    lines.push('');

    if (isLongError) {
      // Make long errors collapsible
      lines.push('<details>');
      lines.push(`<summary>⚠️ Error Details (${errorMessage.length} chars)</summary>`);
      lines.push('');
      lines.push('```');
      lines.push(errorMessage);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
    } else {
      // Short errors displayed inline
      lines.push('```');
      lines.push(errorMessage);
      lines.push('```');
    }

    lines.push('');
  }

  return lines.join('\n');
}
