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
    count: number;
    change: ResourceChangeType;
    oldSku?: string;
    oldRegion?: string;
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
    removedFields: string[];
}
/**
 * Validation result for sensitive data detection
 */
export interface ValidationResult {
    valid: boolean;
    violations: string[];
}
/**
 * Sanitize resource metadata array by removing all identifying information
 * This is the main privacy layer ensuring no PII or resource identifiers reach the backend
 * @param resources - Array of resource metadata to sanitize
 * @param change - Default change type for all resources (can be overridden per-resource)
 * @returns Sanitization result with safe resources and removed field log
 */
export declare function sanitizeResources(resources: ResourceMetadata[], change?: ResourceChangeType): SanitizationResult;
/**
 * Input structure for sanitizing resources with change information
 */
export interface ResourceWithChange {
    resource: ResourceMetadata;
    change: ResourceChangeType;
    oldSku?: string;
    oldRegion?: string;
    oldOsType?: string;
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
export declare function sanitizeResourcesWithChanges(resourcesWithChange: ResourceWithChange[]): SanitizationResult;
/**
 * Validate that sanitized data contains no sensitive information
 * This function is used in tests to ensure the privacy contract is never violated
 * @param data - Data to validate
 * @returns Validation result with violations list
 */
export declare function validateNoSensitiveData(data: unknown): ValidationResult;
//# sourceMappingURL=sanitize.d.ts.map