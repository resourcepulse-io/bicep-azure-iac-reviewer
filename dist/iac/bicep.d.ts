/**
 * Result of compiling a single Bicep file
 */
export interface BicepCompilationResult {
    filePath: string;
    success: boolean;
    armTemplate?: Record<string, unknown>;
    error?: string;
}
/**
 * Download and cache the Bicep CLI binary
 * @returns Path to the Bicep CLI binary
 * @throws Error if download fails or RUNNER_TEMP is not set
 */
export declare function ensureBicepCli(): Promise<string>;
/**
 * Compile a single Bicep file to ARM JSON
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param filePath - Path to the .bicep file to compile
 * @returns Compilation result with ARM template or error
 */
export declare function compileBicepFile(bicepCliPath: string, filePath: string): Promise<BicepCompilationResult>;
/**
 * Compile multiple Bicep files
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param filePaths - Array of .bicep file paths to compile
 * @returns Array of compilation results (both successes and failures)
 */
export declare function compileBicepFiles(bicepCliPath: string, filePaths: string[]): Promise<BicepCompilationResult[]>;
/**
 * Compile Bicep content from a string by writing to a temp file
 * Used for compiling base branch content fetched from GitHub API
 * @param bicepCliPath - Path to the Bicep CLI binary
 * @param content - Bicep file content as string
 * @param originalFilePath - Original file path (used for naming and logging)
 * @returns Compilation result with ARM template or error
 */
export declare function compileBicepContent(bicepCliPath: string, content: string, originalFilePath: string, moduleFiles?: Record<string, string>): Promise<BicepCompilationResult>;
/**
 * Format compilation errors for PR comment
 * @param results - Array of compilation results
 * @returns Markdown-formatted error message, or null if no errors
 */
export declare function formatCompilationErrors(results: BicepCompilationResult[]): string | null;
//# sourceMappingURL=bicep.d.ts.map