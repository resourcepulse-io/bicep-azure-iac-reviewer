import { SanitizedResource } from '../iac/sanitize';
/**
 * Result of the analysis operation
 */
export interface AnalysisResult {
    success: boolean;
    source: 'backend' | 'local';
    markdown: string;
    error?: string;
    blocked?: boolean;
}
/**
 * Repository metadata included in backend request
 */
export interface RepositoryInfo {
    owner: string;
    name: string;
    fullName: string;
}
/**
 * Pull request metadata for backend request
 */
export interface PRInfo {
    number: number;
    headSha: string;
}
/**
 * GitHub Actions run metadata for backend request
 */
export interface RunInfo {
    runId: string;
    attempt: number;
}
/**
 * Git context for backend request
 */
export interface ContextInfo {
    iacEngine: 'bicep';
    envHint: string;
    envSource: 'workflow input' | 'none';
    paramFileUsed?: string;
    paramFileSource: 'workflow input';
    resolvedRegions: string[];
}
/**
 * API resource format - matches backend contract
 */
export interface ApiResource {
    kind: string;
    region?: string;
    sku?: string;
    tier?: string;
    shardCount?: number;
    count: number;
    change: string;
    oldSku?: string;
    oldRegion?: string;
    oldShardCount?: number;
    tags?: Record<string, string>;
    osType?: string;
    oldOsType?: string;
    highAvailability?: string;
    oldHighAvailability?: string;
    licenseType?: string;
    oldLicenseType?: string;
    messagingUnits?: number;
    oldMessagingUnits?: number;
    capacityUnits?: number;
    oldCapacityUnits?: number;
}
/**
 * Full context for backend API call
 */
export interface BackendCallContext {
    repo: RepositoryInfo;
    pr: PRInfo;
    run: RunInfo;
    context: ContextInfo;
}
/**
 * Options for resource analysis
 */
export interface AnalyzeOptions {
    apiKey?: string;
    callContext?: BackendCallContext;
    useDev?: boolean;
    adminKey?: string;
    orgApiKey?: string;
}
/**
 * Analyze resources using backend service or local fallback
 * This is the main entry point for backend integration
 * @param resources - Sanitized resources to analyze
 * @param options - Analysis options including API key, server address, and context
 * @returns Analysis result with markdown message
 */
export declare function analyzeResources(resources: SanitizedResource[], options?: AnalyzeOptions): Promise<AnalysisResult>;
//# sourceMappingURL=client.d.ts.map