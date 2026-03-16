import * as log from '../utils/log';
import { SanitizedResource, validateNoSensitiveData } from '../iac/sanitize';

/**
 * Default backend API URL
 */
const DEFAULT_BACKEND_URL = 'https://dev.resourcepulseapp.com';

/**
 * Result of the analysis operation
 */
export interface AnalysisResult {
  success: boolean;
  source: 'backend' | 'local';
  markdown: string; // Pre-formatted message ready for PR comment
  error?: string; // Error message when backend fails
  blocked?: boolean; // true if a blocking policy rule fired (Pro only)
}

/**
 * Repository metadata included in backend request
 */
export interface RepositoryInfo {
  owner: string;
  name: string;
  fullName: string; // owner/repo format (e.g., "myorg/myrepo")
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
}

/**
 * Request payload sent to backend - matches API contract
 */
interface AnalysisRequest {
  repo: RepositoryInfo;
  pr: PRInfo;
  run: RunInfo;
  context: ContextInfo;
  resources: ApiResource[];
}

/**
 * Backend response format
 */
interface BackendResponse {
  success?: boolean;
  source?: string;
  markdown?: string;
  message?: string;
  error?: string;
  blocked?: boolean;
}

/**
 * Default timeout for backend requests (60 seconds)
 */
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Generate local fallback markdown when backend is unavailable or no API key provided
 * @param resources - Sanitized resources to summarize
 * @returns Markdown formatted summary
 */
function generateLocalFallback(resources: SanitizedResource[]): string {
  // Count resources by kind
  const kindCounts = new Map<string, number>();
  for (const resource of resources) {
    const count = kindCounts.get(resource.kind) || 0;
    kindCounts.set(resource.kind, count + 1);
  }

  // Sort by count (descending) for better display
  const sortedKinds = Array.from(kindCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  // Build markdown summary
  const lines: string[] = [];
  lines.push('## Azure Resource Analysis');
  lines.push('');
  lines.push(
    `Detected **${resources.length}** resource(s) in your Bicep files:`
  );
  lines.push('');

  // If more than 5 resources, make it collapsible
  if (resources.length > 5) {
    lines.push('<details>');
    lines.push(`<summary>📋 Resource Details (${resources.length} resources)</summary>`);
    lines.push('');
  }

  // Resource breakdown by kind
  for (const [kind, count] of sortedKinds) {
    const kindLabel = formatKindLabel(kind);
    lines.push(`- **${kindLabel}**: ${count}`);
  }

  // Close details if we opened it
  if (resources.length > 5) {
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '💡 **Want detailed cost estimates and security recommendations?**'
  );
  lines.push('');
  lines.push(
    'Add an API key to enable full analysis powered by ResourcePulse:'
  );
  lines.push('');
  lines.push('```yaml');
  lines.push('- uses: resourcepulse-io/azure-iac-reviewer@v1');
  lines.push('  with:');
  lines.push('    api_key: ${{ secrets.RESOURCEPULSE_API_KEY }}');
  lines.push('```');
  lines.push('');

  // Add collapsible privacy information
  lines.push('<details>');
  lines.push('<summary>🔒 Privacy Information</summary>');
  lines.push('');
  lines.push(
    'This action analyzes anonymized resource metadata only - no source code or identifiers are transmitted. All sensitive information (names, IDs, secrets) is stripped before analysis.'
  );
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

/**
 * Format resource kind into human-readable label
 * @param kind - Resource kind identifier
 * @returns Formatted label
 */
function formatKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    vm: 'Virtual Machines',
    appservice: 'App Services',
    sqldb: 'SQL Databases',
    storage: 'Storage Accounts',
    vnet: 'Virtual Networks',
    nsg: 'Network Security Groups',
    other: 'Other Resources',
  };

  return labels[kind] || kind.toUpperCase();
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
 * Convert SanitizedResource to ApiResource format
 * @param resource - Sanitized resource
 * @returns API-compatible resource
 */
function toApiResource(resource: SanitizedResource): ApiResource {
  const apiResource: ApiResource = {
    kind: resource.kind,
    region: resource.region,
    sku: resource.sku,
    count: resource.count,
    change: resource.change,
  };

  if (resource.tier !== undefined) {
    apiResource.tier = resource.tier;
  }
  if (resource.shardCount !== undefined) {
    apiResource.shardCount = resource.shardCount;
  }
  if (resource.oldSku !== undefined) {
    apiResource.oldSku = resource.oldSku;
  }
  if (resource.oldRegion !== undefined) {
    apiResource.oldRegion = resource.oldRegion;
  }
  if (resource.oldShardCount !== undefined) {
    apiResource.oldShardCount = resource.oldShardCount;
  }
  if (resource.tags) {
    apiResource.tags = resource.tags;
  }

  return apiResource;
}

/**
 * Result from a backend call attempt, including error details
 */
interface BackendCallResult {
  response: BackendResponse | null;
  error?: string;
  statusCode?: number;
}

/**
 * Call backend API with timeout and error handling
 * @param resources - Sanitized resources to analyze
 * @param apiKey - Backend authentication token
 * @param backendUrl - Backend API endpoint
 * @param callContext - Full context including repo, PR, run, and git context
 * @returns Backend call result with response and error details
 */
async function callBackend(
  resources: SanitizedResource[],
  apiKey: string,
  backendUrl: string,
  callContext: BackendCallContext
): Promise<BackendCallResult> {
  // Validate no sensitive data before sending
  const validation = validateNoSensitiveData(resources);
  if (!validation.valid) {
    log.error('Privacy contract violation detected - refusing to send data');
    log.error(`Violations: ${validation.violations.join(', ')}`);
    throw new Error(
      'Privacy contract violation: Sanitized data contains sensitive information'
    );
  }

  // Convert to API resource format
  const apiResources = resources.map(toApiResource);

  const requestPayload: AnalysisRequest = {
    repo: callContext.repo,
    pr: callContext.pr,
    run: callContext.run,
    context: callContext.context,
    resources: apiResources,
  };

  log.debug(`Calling backend API: ${backendUrl}`);
  log.debug(`Sending ${resources.length} sanitized resource(s)`);
  log.debug(`Repository: ${callContext.repo.fullName}`);
  log.debug(`PR #${callContext.pr.number}: ${callContext.pr.headSha}`);

  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const response = await fetch(`${backendUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'azure-iac-reviewer/1.0.0',
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!response.ok) {
      log.warning(
        `Backend returned status ${response.status}: ${response.statusText}`
      );

      let errorDetail = `HTTP ${response.status}`;

      if (response.status === 401 || response.status === 403) {
        errorDetail = 'Authentication failed — check that your `api_key` is valid and not expired.';
      } else if (response.status === 402) {
        errorDetail = 'Subscription issue — your plan may have expired or reached its limit.';
      } else if (response.status >= 500) {
        errorDetail = `Server error (HTTP ${response.status}) — the ResourcePulse backend is temporarily unavailable.`;
      }

      // Try to parse error message from response body
      try {
        const errorData = (await response.json()) as BackendResponse;
        const apiMessage = errorData.error || errorData.message;
        if (apiMessage) {
          log.warning(`Backend error: ${apiMessage}`);
          errorDetail = apiMessage;
        }
      } catch {
        // Ignore JSON parse errors
      }

      return { response: null, error: errorDetail, statusCode: response.status };
    }

    // Parse successful response
    const data = (await response.json()) as BackendResponse;
    log.debug('Backend response received successfully');

    return { response: data };
  } catch (error: unknown) {
    let errorDetail = 'Unknown error connecting to backend.';

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        log.warning(
          `Backend request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        );
        errorDetail = `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s — the backend may be overloaded.`;
      } else if (
        error.message.includes('fetch failed') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNREFUSED')
      ) {
        log.warning(`Network error calling backend: ${error.message}`);
        errorDetail = 'Network error — could not reach the ResourcePulse backend. Please try again later.';
      } else {
        log.warning(`Error calling backend: ${error.message}`);
        errorDetail = `Unexpected error: ${error.message}`;
      }
    } else {
      log.warning('Unknown error calling backend');
    }

    return { response: null, error: errorDetail };
  }
}

/**
 * Options for resource analysis
 */
export interface AnalyzeOptions {
  apiKey?: string;
  callContext?: BackendCallContext;
}

/**
 * Analyze resources using backend service or local fallback
 * This is the main entry point for backend integration
 * @param resources - Sanitized resources to analyze
 * @param options - Analysis options including API key, server address, and context
 * @returns Analysis result with markdown message
 */
export async function analyzeResources(
  resources: SanitizedResource[],
  options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
  const { apiKey, callContext } = options;
  const backendUrl = DEFAULT_BACKEND_URL;

  log.debug('Starting resource analysis');
  log.debug(`API key provided: ${apiKey ? 'yes' : 'no'}`);
  log.debug(`Server address: ${backendUrl}`);

  // If no API key provided, use local fallback immediately
  if (!apiKey) {
    log.info('No API key provided - using local fallback analysis');
    const markdown = generateLocalFallback(resources);
    return {
      success: true,
      source: 'local',
      markdown,
    };
  }

  // If no call context provided, use local fallback
  if (!callContext) {
    log.warning('No call context provided - using local fallback analysis');
    const markdown = generateLocalFallback(resources);
    return {
      success: true,
      source: 'local',
      markdown,
    };
  }

  // Try to call backend
  log.info(`Attempting backend analysis at ${backendUrl}`);

  const backendResult = await callBackend(
    resources,
    apiKey,
    backendUrl,
    callContext
  );

  // Check if backend response indicates success
  if (backendResult.response) {
    // Respect the success flag from the API response
    if (backendResult.response.success === false) {
      log.warning('Backend returned success=false - falling back to local summary');
      const errorMsg = backendResult.response.error || backendResult.response.message || 'Backend reported failure.';
      const markdown = generateLocalFallback(resources);
      return {
        success: false,
        source: 'local',
        markdown,
        error: errorMsg,
      };
    }

    // Backend succeeded - return its response
    if (backendResult.response.markdown || backendResult.response.message) {
      log.info('Backend analysis completed successfully');
      const markdown = backendResult.response.markdown || backendResult.response.message || '';
      return {
        success: true,
        source: 'backend',
        markdown,
        blocked: backendResult.response.blocked === true,
      };
    }
  }

  // Backend failed - use local fallback with error info
  log.warning('Backend analysis failed - falling back to local summary');
  const markdown = generateLocalFallback(resources);
  return {
    success: false,
    source: 'local',
    markdown,
    error: backendResult.error || 'Backend returned an empty response.',
  };
}
