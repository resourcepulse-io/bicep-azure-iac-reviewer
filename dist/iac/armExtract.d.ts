import type { BicepParamValue } from './bicepParams';
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
    tags?: Record<string, string>;
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
/**
 * Extract resource metadata from compiled ARM JSON template
 * @param armJson - ARM JSON template as a string
 * @returns Extraction result with resources, count, and detected kinds
 * @throws Error if JSON is invalid or missing resources array
 */
export declare function extractResourceMetadata(armJson: string, options?: ExtractionOptions): ExtractionResult;
//# sourceMappingURL=armExtract.d.ts.map