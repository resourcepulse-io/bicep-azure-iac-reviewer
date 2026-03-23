import * as log from '../utils/log';
import { ResourceMetadata } from './armExtract';

/**
 * Change type for resources - matches API contract
 */
export type ResourceChangeType = 'added' | 'modified' | 'removed';

/**
 * Sanitized resource data safe for transmission to backend
 * Only contains non-identifying metadata
 */
export interface SanitizedResource {
  kind: string;
  region?: string;
  sku?: string;
  tier?: string;
  shardCount?: number;
  count: number;
  change: ResourceChangeType;
  // Fields for tracking changes on modified resources (SKU/region upgrades/downgrades)
  oldSku?: string;
  oldRegion?: string;
  oldShardCount?: number;
  // Tag keys only, with empty values
  tags?: Record<string, string>;
  // Cost-dimension fields
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
  // Fields kept for internal use but not sent to API
  type?: string;
  apiVersion?: string;
  safeProperties?: Record<string, unknown>;
}

/**
 * Result of sanitizing resource metadata
 */
export interface SanitizationResult {
  resources: SanitizedResource[];
  resourceCount: number;
  removedFields: string[]; // For logging what was stripped
}

/**
 * Validation result for sensitive data detection
 */
export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Patterns to detect sensitive data that must never be sent to backend
 */
const SENSITIVE_PATTERNS = {
  // GUID pattern: 8-4-4-4-12 hex characters
  guid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  // Azure Resource ID pattern
  resourceId: /\/subscriptions\/[^/]+\/resourceGroups\//i,
  // Connection string patterns
  connectionString:
    /(AccountName|AccountKey|DefaultEndpointsProtocol|EndpointSuffix)=/i,
  // Base64 encoded data (potential secrets)
  base64Long: /^[A-Za-z0-9+/]{40,}={0,2}$/,
};

/**
 * Fields that should always be removed (blacklist)
 */
const FORBIDDEN_FIELDS = new Set([
  'name',
  'id',
  'resourceId',
  'resourceid',
  'dependsOn',
  'dependson',
  'password',
  'secret',
  'key',
  'apikey',
  'apiKey',
  'connectionString',
  'connectionstring',
  'accessKey',
  'accesskey',
  'token',
  'credential',
  'credentials',
  'principalId',
  'principalid',
  'tenantId',
  'tenantid',
  'clientId',
  'clientid',
  'clientSecret',
  'clientsecret',
  'subscriptionId',
  'subscriptionid',
]);

/**
 * Property keys that are safe to keep (whitelist for known safe numeric/boolean properties)
 */
const SAFE_PROPERTY_KEYS = new Set([
  'tier',
  'capacity',
  'size',
  'count',
  'enabled',
  'disabled',
  'replicas',
  'instances',
  'cores',
  'memory',
  'storage',
  'maxsize',
  'minsize',
  'autoscale',
  'version',
  'protocol',
  'port',
  'timeout',
  'retries',
  'interval',
  'threshold',
]);

/**
 * Check if a field name is forbidden (contains sensitive data)
 * @param fieldName - Field name to check
 * @returns True if field should be removed
 */
function isForbiddenField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();

  // Check exact matches
  if (FORBIDDEN_FIELDS.has(lowerField)) {
    return true;
  }

  // Check if field contains forbidden substrings
  for (const forbidden of FORBIDDEN_FIELDS) {
    if (lowerField.includes(forbidden)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a string value contains sensitive data patterns
 * @param value - String value to check
 * @returns True if value contains sensitive patterns
 */
function containsSensitivePattern(value: string): boolean {
  // Check GUID pattern
  if (SENSITIVE_PATTERNS.guid.test(value)) {
    return true;
  }

  // Check resource ID pattern
  if (SENSITIVE_PATTERNS.resourceId.test(value)) {
    return true;
  }

  // Check connection string pattern
  if (SENSITIVE_PATTERNS.connectionString.test(value)) {
    return true;
  }

  // Check for long base64 strings (likely secrets)
  if (value.length > 40 && SENSITIVE_PATTERNS.base64Long.test(value)) {
    return true;
  }

  return false;
}

/**
 * Check if a value is safe to include (primitive safe types)
 * @param value - Value to check
 * @returns True if value is safe
 */
function isSafeValue(value: unknown): boolean {
  // Numbers are always safe
  if (typeof value === 'number') {
    return true;
  }

  // Booleans are always safe
  if (typeof value === 'boolean') {
    return true;
  }

  // Null is safe
  if (value === null) {
    return true;
  }

  // Short strings that are likely enum values are safe
  if (typeof value === 'string') {
    // Very short strings are likely enums/flags
    if (value.length <= 3) {
      return true;
    }

    // Common enum patterns (Enabled, Disabled, true, false, etc.)
    const safeEnums = /^(enabled?|disabled?|true|false|yes|no|on|off|allow|deny|accept|reject)$/i;
    if (safeEnums.test(value)) {
      return true;
    }

    // Check if contains sensitive patterns
    if (containsSensitivePattern(value)) {
      return false;
    }

    // Strings longer than 50 chars are suspicious (likely names/IDs)
    if (value.length > 50) {
      return false;
    }

    // If it's a short string without sensitive patterns, it's likely safe
    return value.length <= 20;
  }

  // Arrays and objects need recursive checking
  return false;
}

/**
 * Sanitize properties object by removing sensitive fields and values
 * @param properties - Properties object to sanitize
 * @param removedFields - Set to track removed field names
 * @returns Sanitized properties or undefined if all fields removed
 */
function sanitizeProperties(
  properties: Record<string, unknown>,
  removedFields: Set<string>
): Record<string, unknown> | undefined {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    // Skip forbidden fields
    if (isForbiddenField(key)) {
      removedFields.add(key);
      continue;
    }

    // Special handling for tags - keep only tag keys, strip actual values for privacy.
    // Use "present" so the API can distinguish "tag exists" from "tag missing".
    if (key.toLowerCase() === 'tags') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sanitizedTags: Record<string, string> = {};
        for (const tagKey of Object.keys(value as Record<string, unknown>)) {
          if (isForbiddenField(tagKey)) {
            removedFields.add(`tags.${tagKey}`);
            continue;
          }
          sanitizedTags[tagKey] = 'present';
        }
        if (Object.keys(sanitizedTags).length > 0) {
          sanitized[key] = sanitizedTags;
        } else {
          removedFields.add(key);
        }
      } else {
        removedFields.add(key);
      }
      continue;
    }

    // Handle nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedSanitized = sanitizeProperties(
        value as Record<string, unknown>,
        removedFields
      );
      if (nestedSanitized && Object.keys(nestedSanitized).length > 0) {
        sanitized[key] = nestedSanitized;
      }
      continue;
    }

    // Handle arrays - only keep if all elements are safe
    if (Array.isArray(value)) {
      const safeArray = value.filter((item) => isSafeValue(item));
      if (safeArray.length > 0 && safeArray.length === value.length) {
        // Only include if we didn't filter anything out
        sanitized[key] = safeArray;
      } else {
        removedFields.add(key);
      }
      continue;
    }

    // Keep value if it's safe or if the key is in the safe list
    if (isSafeValue(value) || SAFE_PROPERTY_KEYS.has(key.toLowerCase())) {
      sanitized[key] = value;
    } else {
      removedFields.add(key);
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Options for sanitizing a single resource
 */
interface SanitizeResourceOptions {
  change?: ResourceChangeType;
  oldSku?: string;
  oldRegion?: string;
  oldShardCount?: number;
  oldOsType?: string;
  oldHighAvailability?: string;
  oldLicenseType?: string;
  oldMessagingUnits?: number;
  oldCapacityUnits?: number;
}

/**
 * Sanitize a single resource by removing all identifying information
 * @param resource - Resource metadata to sanitize
 * @param removedFields - Set to track removed field names
 * @param options - Optional change type and old values for modified resources
 * @returns Sanitized resource
 */
function sanitizeSingleResource(
  resource: ResourceMetadata,
  removedFields: Set<string>,
  options: SanitizeResourceOptions = {}
): SanitizedResource {
  const {
    change = 'modified',
    oldSku,
    oldRegion,
    oldShardCount,
    oldOsType,
    oldHighAvailability,
    oldLicenseType,
    oldMessagingUnits,
    oldCapacityUnits,
  } = options;

  const sanitized: SanitizedResource = {
    kind: resource.kind,
    count: resource.instanceCount ?? 1,
    change,
  };

  // SKU is safe to include (e.g., "Standard_D2s_v3")
  if (resource.sku) sanitized.sku = resource.sku;

  // Tier is safe to include (e.g., "Standard", "Premium")
  if (resource.tier) {
    sanitized.tier = resource.tier;
  }

  // Shard count is safe to include (numeric, non-identifying)
  if (resource.shardCount !== undefined) {
    sanitized.shardCount = resource.shardCount;
  }

  // Region is safe to include (e.g., "eastus")
  if (resource.region) sanitized.region = resource.region;

  // Include old SKU/region/shardCount for modified resources (tracks upgrades/downgrades)
  if (oldSku !== undefined) {
    sanitized.oldSku = oldSku;
  }
  if (oldRegion !== undefined) {
    sanitized.oldRegion = oldRegion;
  }
  if (oldShardCount !== undefined) {
    sanitized.oldShardCount = oldShardCount;
  }

  // Cost-dimension fields - safe enum values, no PII
  if (resource.osType !== undefined) sanitized.osType = resource.osType;
  if (oldOsType !== undefined) sanitized.oldOsType = oldOsType;
  if (resource.highAvailability !== undefined) sanitized.highAvailability = resource.highAvailability;
  if (oldHighAvailability !== undefined) sanitized.oldHighAvailability = oldHighAvailability;
  if (resource.licenseType !== undefined) sanitized.licenseType = resource.licenseType;
  if (oldLicenseType !== undefined) sanitized.oldLicenseType = oldLicenseType;
  if (resource.messagingUnits !== undefined) sanitized.messagingUnits = resource.messagingUnits;
  if (oldMessagingUnits !== undefined) sanitized.oldMessagingUnits = oldMessagingUnits;
  if (resource.capacityUnits !== undefined) sanitized.capacityUnits = resource.capacityUnits;
  if (oldCapacityUnits !== undefined) sanitized.oldCapacityUnits = oldCapacityUnits;

  // Keep type for internal use (optional in API)
  sanitized.type = resource.type;

  // API version is safe to include (e.g., "2023-01-01")
  if (resource.apiVersion) {
    sanitized.apiVersion = resource.apiVersion;
  }

  // Use top-level tags from ARM extraction if available (already key-only)
  if (resource.tags && Object.keys(resource.tags).length > 0) {
    sanitized.tags = resource.tags;
  }

  // Sanitize properties if present
  if (resource.properties) {
    const safeProperties = sanitizeProperties(resource.properties, removedFields);
    if (safeProperties) {
      // Also check for tags nested in properties (fallback for non-standard templates)
      if (!sanitized.tags) {
        const propTags = safeProperties.tags;
        if (propTags && typeof propTags === 'object' && !Array.isArray(propTags)) {
          sanitized.tags = propTags as Record<string, string>;
        }
      }
      delete safeProperties.tags;
      if (Object.keys(safeProperties).length > 0) {
        sanitized.safeProperties = safeProperties;
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize resource metadata array by removing all identifying information
 * This is the main privacy layer ensuring no PII or resource identifiers reach the backend
 * @param resources - Array of resource metadata to sanitize
 * @param change - Default change type for all resources (can be overridden per-resource)
 * @returns Sanitization result with safe resources and removed field log
 */
export function sanitizeResources(
  resources: ResourceMetadata[],
  change: ResourceChangeType = 'modified'
): SanitizationResult {
  log.debug(`Sanitizing ${resources.length} resource(s)`);

  const removedFields = new Set<string>();
  const sanitizedResources: SanitizedResource[] = [];

  for (const resource of resources) {
    const sanitized = sanitizeSingleResource(resource, removedFields, { change });
    sanitizedResources.push(sanitized);
  }

  const removedFieldsList = Array.from(removedFields).sort();
  if (removedFieldsList.length > 0) {
    log.debug(`Removed sensitive fields: ${removedFieldsList.join(', ')}`);
  }

  log.debug(
    `Sanitization complete: ${sanitizedResources.length} resource(s) sanitized`
  );

  return {
    resources: sanitizedResources,
    resourceCount: sanitizedResources.length,
    removedFields: removedFieldsList,
  };
}

/**
 * Input structure for sanitizing resources with change information
 */
export interface ResourceWithChange {
  resource: ResourceMetadata;
  change: ResourceChangeType;
  oldSku?: string;
  oldRegion?: string;
  oldShardCount?: number;
  oldOsType?: string;
  // Previous state for mutable cost dimensions (modified resources only)
  oldHighAvailability?: string;
  oldLicenseType?: string;
  oldMessagingUnits?: number;
  oldCapacityUnits?: number;
}

/**
 * Sanitize resources with individual change types
 * @param resourcesWithChange - Array of resources with change type and optional old values
 * @returns Sanitization result with safe resources and removed field log
 */
export function sanitizeResourcesWithChanges(
  resourcesWithChange: ResourceWithChange[]
): SanitizationResult {
  log.debug(`Sanitizing ${resourcesWithChange.length} resource(s) with individual change types`);

  const removedFields = new Set<string>();
  const sanitizedResources: SanitizedResource[] = [];

  for (const {
    resource,
    change,
    oldSku,
    oldRegion,
    oldShardCount,
    oldOsType,
    oldHighAvailability,
    oldLicenseType,
    oldMessagingUnits,
    oldCapacityUnits,
  } of resourcesWithChange) {
    const sanitized = sanitizeSingleResource(resource, removedFields, {
      change,
      oldSku,
      oldRegion,
      oldShardCount,
      oldOsType,
      oldHighAvailability,
      oldLicenseType,
      oldMessagingUnits,
      oldCapacityUnits,
    });
    sanitizedResources.push(sanitized);
  }

  const removedFieldsList = Array.from(removedFields).sort();
  if (removedFieldsList.length > 0) {
    log.debug(`Removed sensitive fields: ${removedFieldsList.join(', ')}`);
  }

  log.debug(
    `Sanitization complete: ${sanitizedResources.length} resource(s) sanitized`
  );

  return {
    resources: sanitizedResources,
    resourceCount: sanitizedResources.length,
    removedFields: removedFieldsList,
  };
}

/**
 * Recursively scan an object for sensitive data patterns
 * Used for testing the privacy contract
 * @param obj - Object to scan
 * @param path - Current path in object (for violation reporting)
 * @param violations - Array to collect violations
 */
function scanForSensitiveData(
  obj: unknown,
  path: string,
  violations: string[]
): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // Check strings for sensitive patterns
  if (typeof obj === 'string') {
    if (SENSITIVE_PATTERNS.guid.test(obj)) {
      violations.push(`GUID found at ${path}: ${obj.substring(0, 36)}...`);
    }
    if (SENSITIVE_PATTERNS.resourceId.test(obj)) {
      violations.push(`Resource ID found at ${path}: ${obj.substring(0, 50)}...`);
    }
    if (SENSITIVE_PATTERNS.connectionString.test(obj)) {
      violations.push(`Connection string found at ${path}`);
    }
    return;
  }

  // Check arrays
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      scanForSensitiveData(item, `${path}[${index}]`, violations);
    });
    return;
  }

  // Check objects
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;

      // Check if key itself is forbidden
      if (isForbiddenField(key)) {
        violations.push(`Forbidden field found: ${newPath}`);
      }

      // Recursively check value
      scanForSensitiveData(value, newPath, violations);
    }
  }
}

/**
 * Validate that sanitized data contains no sensitive information
 * This function is used in tests to ensure the privacy contract is never violated
 * @param data - Data to validate
 * @returns Validation result with violations list
 */
export function validateNoSensitiveData(data: unknown): ValidationResult {
  const violations: string[] = [];
  scanForSensitiveData(data, '', violations);

  return {
    valid: violations.length === 0,
    violations,
  };
}
