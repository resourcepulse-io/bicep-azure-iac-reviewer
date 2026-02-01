import * as log from '../utils/log';

/**
 * Metadata extracted from a single ARM resource
 */
export interface ResourceMetadata {
  type: string;
  kind: string;
  sku?: string;
  region?: string;
  apiVersion?: string;
  properties?: Record<string, unknown>;
}

/**
 * Result of extracting resource metadata from ARM JSON
 */
export interface ExtractionResult {
  resources: ResourceMetadata[];
  resourceCount: number;
  kindsDetected: string[];
}

/**
 * ARM resource type to normalized kind mapping
 */
const TYPE_TO_KIND_MAP: Record<string, string> = {
  'Microsoft.Compute/virtualMachines': 'vm',
  'Microsoft.Web/serverfarms': 'appservice',
  'Microsoft.Web/sites': 'appservice',
  'Microsoft.Sql/servers/databases': 'sqldb',
  'Microsoft.Storage/storageAccounts': 'storage',
  'Microsoft.Network/virtualNetworks': 'vnet',
  'Microsoft.Network/networkSecurityGroups': 'nsg',
};

/**
 * Normalize ARM resource type to a simplified kind
 * @param type - ARM resource type (e.g., "Microsoft.Compute/virtualMachines")
 * @returns Normalized kind (e.g., "vm") or "other" if not mapped
 */
function normalizeResourceType(type: string): string {
  return TYPE_TO_KIND_MAP[type] || 'other';
}

/**
 * Extract SKU information from an ARM resource
 * SKU can be in various formats:
 * - { sku: { name: "Standard_D2s_v3" } }
 * - { sku: { tier: "Standard" } }
 * - { properties: { sku: "S1" } }
 * @param resource - ARM resource object
 * @returns SKU string if found, undefined otherwise
 */
function extractSku(resource: Record<string, unknown>): string | undefined {
  // Try resource.sku.name
  if (resource.sku && typeof resource.sku === 'object') {
    const sku = resource.sku as Record<string, unknown>;
    if (sku.name && typeof sku.name === 'string') {
      return sku.name;
    }
    // Try resource.sku.tier
    if (sku.tier && typeof sku.tier === 'string') {
      return sku.tier;
    }
  }

  // Try resource.properties.sku
  if (resource.properties && typeof resource.properties === 'object') {
    const properties = resource.properties as Record<string, unknown>;
    if (properties.sku && typeof properties.sku === 'string') {
      return properties.sku;
    }
    // Try resource.properties.sku.name
    if (properties.sku && typeof properties.sku === 'object') {
      const sku = properties.sku as Record<string, unknown>;
      if (sku.name && typeof sku.name === 'string') {
        return sku.name;
      }
    }
  }

  return undefined;
}

/**
 * Extract region/location from an ARM resource
 * @param resource - ARM resource object
 * @returns Region string if found, undefined otherwise
 */
function extractRegion(resource: Record<string, unknown>): string | undefined {
  if (resource.location && typeof resource.location === 'string') {
    return resource.location;
  }
  return undefined;
}

/**
 * Extract API version from an ARM resource
 * @param resource - ARM resource object
 * @returns API version string if found, undefined otherwise
 */
function extractApiVersion(
  resource: Record<string, unknown>
): string | undefined {
  if (resource.apiVersion && typeof resource.apiVersion === 'string') {
    return resource.apiVersion;
  }
  return undefined;
}

/**
 * Extract relevant properties from an ARM resource
 * Only includes non-sensitive properties that may be useful for analysis
 * @param resource - ARM resource object
 * @returns Properties object or undefined
 */
function extractProperties(
  resource: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (resource.properties && typeof resource.properties === 'object') {
    // Return a shallow copy of properties
    // The sanitization module will handle removing sensitive data
    return { ...(resource.properties as Record<string, unknown>) };
  }
  return undefined;
}

/**
 * Extract metadata from a single ARM resource
 * @param resource - ARM resource object
 * @returns Resource metadata
 */
function extractSingleResourceMetadata(
  resource: Record<string, unknown>
): ResourceMetadata {
  const type =
    resource.type && typeof resource.type === 'string'
      ? resource.type
      : 'unknown';
  const kind = normalizeResourceType(type);
  const sku = extractSku(resource);
  const region = extractRegion(resource);
  const apiVersion = extractApiVersion(resource);
  const properties = extractProperties(resource);

  const metadata: ResourceMetadata = {
    type,
    kind,
  };

  // Only include optional fields if they exist
  if (sku !== undefined) {
    metadata.sku = sku;
  }
  if (region !== undefined) {
    metadata.region = region;
  }
  if (apiVersion !== undefined) {
    metadata.apiVersion = apiVersion;
  }
  if (properties !== undefined) {
    metadata.properties = properties;
  }

  return metadata;
}

/**
 * Recursively extract resources from ARM template, including nested resources
 * @param resources - Array of ARM resources
 * @param accumulated - Accumulator for recursively collected resources
 * @returns Array of resource metadata
 */
function extractResourcesRecursive(
  resources: unknown[],
  accumulated: ResourceMetadata[] = []
): ResourceMetadata[] {
  for (const resource of resources) {
    if (typeof resource !== 'object' || resource === null) {
      continue;
    }

    const resourceObj = resource as Record<string, unknown>;

    // Extract metadata from current resource
    const metadata = extractSingleResourceMetadata(resourceObj);
    accumulated.push(metadata);

    // Check for nested resources
    if (Array.isArray(resourceObj.resources)) {
      extractResourcesRecursive(resourceObj.resources, accumulated);
    }
  }

  return accumulated;
}

/**
 * Extract resource metadata from compiled ARM JSON template
 * @param armJson - ARM JSON template as a string
 * @returns Extraction result with resources, count, and detected kinds
 * @throws Error if JSON is invalid or missing resources array
 */
export function extractResourceMetadata(armJson: string): ExtractionResult {
  log.debug('Extracting resource metadata from ARM template');

  // Parse ARM JSON
  let armTemplate: Record<string, unknown>;
  try {
    armTemplate = JSON.parse(armJson) as Record<string, unknown>;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ARM JSON: ${errorMessage}`);
  }

  // Validate resources array exists
  if (!Array.isArray(armTemplate.resources)) {
    throw new Error(
      'ARM template is missing resources array or resources is not an array'
    );
  }

  // Extract resources recursively (handles nested resources)
  const resources = extractResourcesRecursive(armTemplate.resources);

  // Calculate statistics
  const resourceCount = resources.length;
  const kindsDetected = [...new Set(resources.map((r) => r.kind))];

  log.debug(
    `Extracted ${resourceCount} resource(s), kinds detected: ${kindsDetected.join(', ')}`
  );

  return {
    resources,
    resourceCount,
    kindsDetected,
  };
}
