import { ResourceMetadata } from './armExtract';
/**
 * Change type for individual resources within a diff
 */
export type ResourceDiffChange = 'added' | 'removed' | 'modified' | 'unchanged';
/**
 * Represents the difference between base and head versions of a resource
 */
export interface ResourceDiff {
    type: string;
    kind: string;
    change: ResourceDiffChange;
    tier?: string;
    newSku?: string;
    newRegion?: string;
    newShardCount?: number;
    oldSku?: string;
    oldRegion?: string;
    oldShardCount?: number;
    properties?: Record<string, unknown>;
    tags?: Record<string, string>;
    osType?: string;
    oldOsType?: string;
    highAvailability?: string;
    licenseType?: string;
    oldLicenseType?: string;
    messagingUnits?: number;
    capacityUnits?: number;
    oldHighAvailability?: string;
    oldMessagingUnits?: number;
    oldCapacityUnits?: number;
}
/**
 * Result of diffing resources between base and head
 */
export interface DiffResult {
    diffs: ResourceDiff[];
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
}
/**
 * Diff resources between base branch and head branch versions
 * Detects added, removed, and modified resources at the individual level
 * @param baseResources - Resources from base branch (e.g., main)
 * @param headResources - Resources from head branch (PR)
 * @returns Array of resource diffs with change information
 */
export declare function diffResources(baseResources: ResourceMetadata[], headResources: ResourceMetadata[]): DiffResult;
//# sourceMappingURL=resourceDiff.d.ts.map