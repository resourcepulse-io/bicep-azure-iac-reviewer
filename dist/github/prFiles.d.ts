import { Octokit } from '@octokit/rest';
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
 * List all files changed in a pull request
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of changed files
 * @throws Error if API call fails
 */
export declare function listChangedFiles(octokit: Octokit, context: PRContext): Promise<ChangedFile[]>;
/**
 * Filter files by extension
 * @param files - Array of changed files
 * @param extension - File extension to filter by (with or without leading dot)
 * @returns Filtered array of filenames
 */
export declare function filterFilesByExtension(files: ChangedFile[], extension: string): string[];
/**
 * Filter files by extension and include change status
 * @param files - Array of changed files
 * @param extension - File extension to filter by (with or without leading dot)
 * @returns Filtered array of files with change status
 */
export declare function filterFilesByExtensionWithStatus(files: ChangedFile[], extension: string): BicepFileWithStatus[];
/**
 * List changed .bicep files in a pull request
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of .bicep file paths
 * @throws Error if API call fails
 */
export declare function listBicepFiles(octokit: Octokit, context: PRContext): Promise<string[]>;
/**
 * List changed .bicep files in a pull request with their change status
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and PR number
 * @returns Array of .bicep files with change status
 * @throws Error if API call fails
 */
export declare function listBicepFilesWithStatus(octokit: Octokit, context: PRContext): Promise<BicepFileWithStatus[]>;
/**
 * Fetch the content of a file from the base branch (e.g., main) for comparison
 * @param octokit - Authenticated Octokit instance
 * @param context - PR context with owner, repo, and base branch
 * @param filename - Path to the file in the repository
 * @returns File content as string, or null if file doesn't exist in base branch
 */
export declare function getBaseFileContent(octokit: Octokit, context: PRContext, filename: string): Promise<string | null>;
//# sourceMappingURL=prFiles.d.ts.map