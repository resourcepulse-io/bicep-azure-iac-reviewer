import { Octokit } from '@octokit/rest';
import * as log from '../utils/log';
import { PRContext } from './context';

/**
 * Represents a changed file in a pull request
 */
export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

/**
 * Change type for resources - maps to API contract
 */
export type ChangeType = 'added' | 'modified' | 'removed';

/**
 * Bicep file with its change status
 */
export interface BicepFileWithStatus {
  filename: string;
  change: ChangeType;
}

/**
 * Map GitHub file status to API change type
 * @param status - GitHub file status
 * @returns Normalized change type
 */
function mapFileStatusToChangeType(status: string): ChangeType {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'modified':
    case 'changed':
    case 'renamed':
    case 'copied':
    default:
      return 'modified';
  }
}

/**
 * List all files changed in a pull request
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of changed files
 * @throws Error if API call fails
 */
export async function listChangedFiles(
  octokit: Octokit,
  context: PRContext
): Promise<ChangedFile[]> {
  log.debug(
    `Fetching changed files for PR #${context.prNumber} in ${context.owner}/${context.repo}`
  );

  try {
    const response = await octokit.rest.pulls.listFiles({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.prNumber,
      per_page: 100, // GitHub API default
    });

    const files: ChangedFile[] = response.data.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    }));

    log.debug(`Found ${files.length} changed file(s) in PR`);

    return files;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to list changed files for PR #${context.prNumber}: ${errorMessage}`
    );
  }
}

/**
 * Filter files by extension
 * @param files - Array of changed files
 * @param extension - File extension to filter by (with or without leading dot)
 * @returns Filtered array of filenames
 */
export function filterFilesByExtension(
  files: ChangedFile[],
  extension: string
): string[] {
  // Normalize extension to always have leading dot and lowercase
  const normalizedExt = (
    extension.startsWith('.') ? extension : `.${extension}`
  ).toLowerCase();

  const filtered = files
    .filter((file) => file.filename.toLowerCase().endsWith(normalizedExt))
    .map((file) => file.filename);

  return filtered;
}

/**
 * Filter files by extension and include change status
 * @param files - Array of changed files
 * @param extension - File extension to filter by (with or without leading dot)
 * @returns Filtered array of files with change status
 */
export function filterFilesByExtensionWithStatus(
  files: ChangedFile[],
  extension: string
): BicepFileWithStatus[] {
  // Normalize extension to always have leading dot and lowercase
  const normalizedExt = (
    extension.startsWith('.') ? extension : `.${extension}`
  ).toLowerCase();

  return files
    .filter((file) => file.filename.toLowerCase().endsWith(normalizedExt))
    .map((file) => ({
      filename: file.filename,
      change: mapFileStatusToChangeType(file.status),
    }));
}

/**
 * List changed .bicep files in a pull request
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of .bicep file paths
 * @throws Error if API call fails
 */
export async function listBicepFiles(
  octokit: Octokit,
  context: PRContext
): Promise<string[]> {
  log.info('Detecting changed .bicep files in PR');

  const allFiles = await listChangedFiles(octokit, context);
  const bicepFiles = filterFilesByExtension(allFiles, '.bicep');

  if (bicepFiles.length === 0) {
    log.info('No .bicep files detected in PR changes');
  } else {
    log.info(`Detected ${bicepFiles.length} .bicep file(s):`);
    bicepFiles.forEach((file) => {
      log.info(`  - ${file}`);
    });
  }

  return bicepFiles;
}

/**
 * List changed .bicep files in a pull request with their change status
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of .bicep files with change status
 * @throws Error if API call fails
 */
export async function listBicepFilesWithStatus(
  octokit: Octokit,
  context: PRContext
): Promise<BicepFileWithStatus[]> {
  log.info('Detecting changed .bicep files in PR with status');

  const allFiles = await listChangedFiles(octokit, context);
  const bicepFiles = filterFilesByExtensionWithStatus(allFiles, '.bicep');

  if (bicepFiles.length === 0) {
    log.info('No .bicep files detected in PR changes');
  } else {
    log.info(`Detected ${bicepFiles.length} .bicep file(s):`);
    bicepFiles.forEach((file) => {
      log.info(`  - ${file.filename} (${file.change})`);
    });
  }

  return bicepFiles;
}

/**
 * Fetch the content of a file from the base branch (e.g., main) for comparison
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and base branch
 * @param filename - Path to the file in the repository
 * @returns File content as string, or null if file doesn't exist in base branch
 */
export async function getBaseFileContent(
  octokit: Octokit,
  context: PRContext,
  filename: string
): Promise<string | null> {
  try {
    log.debug(`Fetching base branch content for ${filename} from ${context.baseBranch}`);

    const response = await octokit.rest.repos.getContent({
      owner: context.owner,
      repo: context.repo,
      path: filename,
      ref: context.baseBranch,
    });

    if ('content' in response.data && typeof response.data.content === 'string') {
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      log.debug(`Successfully fetched base content for ${filename} (${content.length} bytes)`);
      return content;
    }

    log.debug(`No content found for ${filename} in base branch (might be a directory)`);
    return null;
  } catch (error) {
    // File doesn't exist in base branch (new file) or other error
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.debug(`Could not fetch base content for ${filename}: ${errorMessage}`);
    return null;
  }
}
