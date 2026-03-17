import * as log from '../utils/log';
import type { BicepParamValue } from './bicepParams';

/**
 * Metadata extracted from a single ARM resource
 */
export interface ResourceMetadata {
  type: string;
  kind: string;
  sku?: string;
  tier?: string;
  shardCount?: number;
  region?: string;
  apiVersion?: string;
  properties?: Record<string, unknown>;
  tags?: Record<string, string>;
  // Cost-dimension fields extracted per resource type
  osType?: string;           // "linux" | "windows"  (App Service, VM, VMSS)
  highAvailability?: string; // "Disabled" | "SameZone" | "ZoneRedundant"  (PostgreSQL)
  licenseType?: string;      // "LicenseIncluded" | "BasePrice"  (SQL Database)
  messagingUnits?: number;   // sku.capacity  (Service Bus Premium)
  capacityUnits?: number;    // sku.capacity  (APIM)
}

/**
 * Result of extracting resource metadata from ARM JSON
 */
export interface ExtractionResult {
  resources: ResourceMetadata[];
  resourceCount: number;
  kindsDetected: string[];
  resolvedRegions: string[];
  unresolvedLocations: string[];
}

/**
 * Options for extracting resource metadata
 */
export interface ExtractionOptions {
  paramValues?: Record<string, BicepParamValue>;
  enableRegionResolution?: boolean;
}

interface RegionResolutionContext {
  paramValues?: Record<string, BicepParamValue>;
  enableRegionResolution: boolean;
  unresolvedLocations?: string[];
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
  // AKS: vmSize lives in properties.agentPoolProfiles[0].vmSize.
  // This takes priority over sku.tier ("Standard"/"Free") because node VMs are
  // the actual cost driver — the management fee is a fixed ~$73/month add-on.
  if (resource.properties && typeof resource.properties === 'object') {
    const props = resource.properties as Record<string, unknown>;
    if (Array.isArray(props.agentPoolProfiles) && props.agentPoolProfiles.length > 0) {
      const firstPool = props.agentPoolProfiles[0] as Record<string, unknown>;
      if (firstPool.vmSize && typeof firstPool.vmSize === 'string') {
        return firstPool.vmSize;
      }
    }
  }

  // Try resource.sku
  if (resource.sku && typeof resource.sku === 'object') {
    const sku = resource.sku as Record<string, unknown>;

    // Redis/Cache: SKU is split across name (tier), family, and capacity → build "{family}{capacity}"
    // e.g. { name: 'Basic', family: 'C', capacity: 1 } → "C1"
    if (sku.family && typeof sku.family === 'string' && typeof sku.capacity === 'number') {
      return `${sku.family}${sku.capacity}`;
    }

    // AKS: sku.name is generic ("Base"), pricing uses sku.tier ("Standard")
    // Prefer tier when name is a generic AKS identifier
    if (sku.name && typeof sku.name === 'string') {
      const genericSkuNames = ['base', 'free'];
      if (genericSkuNames.includes(sku.name.toLowerCase()) && sku.tier && typeof sku.tier === 'string') {
        return sku.tier;
      }
      return sku.name;
    }

    // Try resource.sku.tier as fallback
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
    // Try resource.properties.sku (object form)
    if (properties.sku && typeof properties.sku === 'object') {
      const sku = properties.sku as Record<string, unknown>;
      // Redis/Cache: SKU is split across name (tier), family, and capacity → build "{family}{capacity}"
      // e.g. { name: 'Basic', family: 'C', capacity: 1 } → "C1"
      if (sku.family && typeof sku.family === 'string' && typeof sku.capacity === 'number') {
        return `${sku.family}${sku.capacity}`;
      }
      if (sku.name && typeof sku.name === 'string') {
        return sku.name;
      }
    }
    // Try resource.properties.hardwareProfile.vmSize (VMs)
    if (properties.hardwareProfile && typeof properties.hardwareProfile === 'object') {
      const hw = properties.hardwareProfile as Record<string, unknown>;
      if (hw.vmSize && typeof hw.vmSize === 'string') {
        return hw.vmSize;
      }
    }
  }

  return undefined;
}

/**
 * Extract tier from an ARM resource (Redis-specific: sku.name holds tier when sku.family is present)
 * @param resource - ARM resource object
 * @returns Tier string if found, undefined otherwise
 */
function extractTier(resource: Record<string, unknown>): string | undefined {
  if (resource.sku && typeof resource.sku === 'object') {
    const sku = resource.sku as Record<string, unknown>;
    // Redis pattern: { name: 'Standard', family: 'C', capacity: 2 } — name is the tier
    if (sku.family && typeof sku.family === 'string' && sku.name && typeof sku.name === 'string') {
      return sku.name;
    }
  }
  return undefined;
}

/**
 * Extract shard count from an ARM resource (Redis Premium: properties.shardCount)
 * @param resource - ARM resource object
 * @returns Shard count if found, undefined otherwise
 */
function extractShardCount(resource: Record<string, unknown>): number | undefined {
  if (resource.properties && typeof resource.properties === 'object') {
    const properties = resource.properties as Record<string, unknown>;
    if (properties.shardCount != null && typeof properties.shardCount === 'number') {
      return properties.shardCount;
    }
  }
  return undefined;
}

/**
 * Extract region/location from an ARM resource
 * @param resource - ARM resource object
 * @returns Region string if found, undefined otherwise
 */
function isArmExpression(value: string): boolean {
  return value.startsWith('[') && value.endsWith(']');
}

function normalizeArmExpression(value: string): string {
  return value.slice(1, -1).trim();
}

function resolveLocationExpression(
  expression: string,
  paramValues?: Record<string, BicepParamValue>
): string | undefined {
  const inner = normalizeArmExpression(expression);

  const paramMatch = inner.match(/^parameters\(\s*'([^']+)'\s*\)$/);
  if (paramMatch) {
    const paramName = paramMatch[1];
    const value = paramValues?.[paramName];
    return typeof value === 'string' ? value : undefined;
  }

  if (inner === 'resourceGroup().location') {
    const value = paramValues?.location;
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

function extractRegion(
  resource: Record<string, unknown>,
  context: RegionResolutionContext
): string | undefined {
  if (!context.enableRegionResolution) {
    return undefined;
  }

  if (resource.location && typeof resource.location === 'string') {
    const location = resource.location;
    if (isArmExpression(location)) {
      const resolved = resolveLocationExpression(location, context.paramValues);
      if (resolved === undefined && context.unresolvedLocations) {
        context.unresolvedLocations.push(normalizeArmExpression(location));
      }
      return resolved;
    }
    return location;
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
 * Extract tags from an ARM resource (top-level field, not under properties)
 * Tag values are stripped for privacy - only keys are kept
 * @param resource - ARM resource object
 * @returns Tag keys with empty values, or undefined if no tags
 */
function extractTags(
  resource: Record<string, unknown>
): Record<string, string> | undefined {
  if (resource.tags && typeof resource.tags === 'object' && !Array.isArray(resource.tags)) {
    const tags = resource.tags as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const key of Object.keys(tags)) {
      // Keep tag keys, strip actual values for privacy.
      // Use "present" so the API can distinguish "tag exists" from "tag missing"
      // (the rule condition fires on empty string, which is the GetValueOrDefault fallback).
      result[key] = 'present';
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

function normalizeLiteralOsType(value: unknown): string | undefined {
  if (typeof value !== 'string' || isArmExpression(value)) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'windows') {
    return 'windows';
  }
  if (normalized === 'linux') {
    return 'linux';
  }

  return undefined;
}

/**
 * Extract OS type for App Service plans, VMs, and VMSS.
 * Returns "linux" or "windows", or undefined for other resource types.
 */
function extractOsType(resource: Record<string, unknown>, type: string): string | undefined {
  const lowerType = type.toLowerCase();

  // App Service Plan: top-level "kind" field contains "linux" for Linux plans; absent or "app" = Windows
  if (lowerType === 'microsoft.web/serverfarms') {
    const kind = resource.kind;
    if (typeof kind === 'string' && !isArmExpression(kind) && kind.toLowerCase().includes('linux')) {
      return 'linux';
    }
    return 'windows';
  }

  // Virtual Machine: properties.storageProfile.osDisk.osType
  if (lowerType === 'microsoft.compute/virtualmachines') {
    const props = resource.properties as Record<string, unknown> | undefined;
    const storageProfile = props?.storageProfile as Record<string, unknown> | undefined;
    const osDisk = storageProfile?.osDisk as Record<string, unknown> | undefined;
    return normalizeLiteralOsType(osDisk?.osType);
  }

  // Virtual Machine Scale Set: properties.virtualMachineProfile.storageProfile.osDisk.osType
  if (lowerType === 'microsoft.compute/virtualmachinescalesets') {
    const props = resource.properties as Record<string, unknown> | undefined;
    const vmProfile = props?.virtualMachineProfile as Record<string, unknown> | undefined;
    const storageProfile = vmProfile?.storageProfile as Record<string, unknown> | undefined;
    const osDisk = storageProfile?.osDisk as Record<string, unknown> | undefined;
    return normalizeLiteralOsType(osDisk?.osType);
  }

  return undefined;
}

/**
 * Extract PostgreSQL Flexible Server high-availability mode.
 * Returns "Disabled" | "SameZone" | "ZoneRedundant", or undefined for other types.
 * Defaults to "Disabled" when the property is absent on a PostgreSQL resource
 * (absence means HA is off — safe default that avoids double-counting).
 */
function extractHighAvailability(resource: Record<string, unknown>, type: string): string | undefined {
  if (type.toLowerCase() !== 'microsoft.dbforpostgresql/flexibleservers') {
    return undefined;
  }
  const props = resource.properties as Record<string, unknown> | undefined;
  const ha = props?.highAvailability as Record<string, unknown> | undefined;
  const mode = ha?.mode;
  if (typeof mode === 'string') {
    return mode;
  }
  return 'Disabled';
}

/**
 * Extract SQL Database license type.
 * Returns "LicenseIncluded" | "BasePrice", or undefined for other resource types.
 * When absent on a SQL DB resource, returns undefined — the API applies "LicenseIncluded" as default.
 */
function extractLicenseType(resource: Record<string, unknown>, type: string): string | undefined {
  if (type.toLowerCase() !== 'microsoft.sql/servers/databases') {
    return undefined;
  }
  const props = resource.properties as Record<string, unknown> | undefined;
  const licenseType = props?.licenseType;
  if (typeof licenseType === 'string') {
    return licenseType;
  }
  return undefined;
}

/**
 * Extract Service Bus messaging unit count (sku.capacity).
 * Only applicable to Microsoft.ServiceBus/namespaces Premium tier.
 * Returns undefined for other resource types or when capacity is absent.
 */
function extractMessagingUnits(resource: Record<string, unknown>, type: string): number | undefined {
  if (type.toLowerCase() !== 'microsoft.servicebus/namespaces') {
    return undefined;
  }
  const sku = resource.sku as Record<string, unknown> | undefined;
  const capacity = sku?.capacity;
  if (typeof capacity === 'number' && capacity > 0) {
    return capacity;
  }
  return undefined;
}

/**
 * Extract APIM capacity unit count (sku.capacity).
 * Only applicable to Microsoft.ApiManagement/service.
 * Returns undefined for other resource types or when capacity is absent.
 */
function extractCapacityUnits(resource: Record<string, unknown>, type: string): number | undefined {
  if (type.toLowerCase() !== 'microsoft.apimanagement/service') {
    return undefined;
  }
  const sku = resource.sku as Record<string, unknown> | undefined;
  const capacity = sku?.capacity;
  if (typeof capacity === 'number' && capacity > 0) {
    return capacity;
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
  resource: Record<string, unknown>,
  context: RegionResolutionContext
): ResourceMetadata {
  const type =
    resource.type && typeof resource.type === 'string'
      ? resource.type
      : 'unknown';
  // Pass raw ARM type as kind - the backend handles mapping to short names
  const kind = type;
  const sku = extractSku(resource);
  const tier = extractTier(resource);
  const shardCount = extractShardCount(resource);
  const region = extractRegion(resource, context);
  const apiVersion = extractApiVersion(resource);
  const properties = extractProperties(resource);
  const tags = extractTags(resource);
  const osType = extractOsType(resource, type);
  const highAvailability = extractHighAvailability(resource, type);
  const licenseType = extractLicenseType(resource, type);
  const messagingUnits = extractMessagingUnits(resource, type);
  const capacityUnits = extractCapacityUnits(resource, type);

  const metadata: ResourceMetadata = {
    type,
    kind,
  };

  // Only include optional fields if they exist
  if (sku !== undefined) {
    metadata.sku = sku;
  }
  if (tier !== undefined) {
    metadata.tier = tier;
  }
  if (shardCount !== undefined) {
    metadata.shardCount = shardCount;
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
  if (tags !== undefined) {
    metadata.tags = tags;
  }
  if (osType !== undefined) {
    metadata.osType = osType;
  }
  if (highAvailability !== undefined) {
    metadata.highAvailability = highAvailability;
  }
  if (licenseType !== undefined) {
    metadata.licenseType = licenseType;
  }
  if (messagingUnits !== undefined) {
    metadata.messagingUnits = messagingUnits;
  }
  if (capacityUnits !== undefined) {
    metadata.capacityUnits = capacityUnits;
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
  context: RegionResolutionContext,
  accumulated: ResourceMetadata[] = []
): ResourceMetadata[] {
  for (const resource of resources) {
    if (typeof resource !== 'object' || resource === null) {
      continue;
    }

    const resourceObj = resource as Record<string, unknown>;

    // Skip Microsoft.Web/sites that are not function apps.
    // Web app instances (kind: "app") have no SKU — the plan (serverfarm) already covers their cost.
    // Function apps (kind contains "functionapp") are also skipped because the consumption plan
    // (Y1/Dynamic) or the premium plan is already extracted and priced separately.
    const resourceType =
      resourceObj.type && typeof resourceObj.type === 'string'
        ? resourceObj.type.toLowerCase()
        : '';
    if (resourceType === 'microsoft.web/sites') {
      continue;
    }

    // Extract metadata from current resource
    const metadata = extractSingleResourceMetadata(resourceObj, context);
    accumulated.push(metadata);

    // Check for nested resources
    if (Array.isArray(resourceObj.resources)) {
      extractResourcesRecursive(resourceObj.resources, context, accumulated);
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
export function extractResourceMetadata(
  armJson: string,
  options: ExtractionOptions = {}
): ExtractionResult {
  log.debug('Extracting resource metadata from ARM template');

  const { paramValues, enableRegionResolution = true } = options;

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

  const unresolvedLocations = enableRegionResolution && paramValues ? [] : undefined;
  const context: RegionResolutionContext = {
    paramValues,
    enableRegionResolution,
    unresolvedLocations,
  };

  // Extract resources recursively (handles nested resources)
  const resources = extractResourcesRecursive(armTemplate.resources, context);

  // Calculate statistics
  const resourceCount = resources.length;
  const kindsDetected = [...new Set(resources.map((r) => r.kind))];
  const resolvedRegions = [
    ...new Set(
      resources
        .map((resource) => resource.region)
        .filter((region): region is string => typeof region === 'string' && region.length > 0)
    ),
  ];
  const unresolvedLocationTokens = unresolvedLocations
    ? [...new Set(unresolvedLocations)]
    : [];

  log.debug(
    `Extracted ${resourceCount} resource(s), kinds detected: ${kindsDetected.join(', ')}`
  );

  return {
    resources,
    resourceCount,
    kindsDetected,
    resolvedRegions,
    unresolvedLocations: unresolvedLocationTokens,
  };
}
