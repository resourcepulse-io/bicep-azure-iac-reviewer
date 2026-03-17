import * as log from '../utils/log';
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
  // Cost-dimension fields (current/new state)
  osType?: string;
  oldOsType?: string;
  highAvailability?: string;
  licenseType?: string;
  oldLicenseType?: string;
  messagingUnits?: number;
  capacityUnits?: number;
  // Previous state for mutable cost dimensions (modified resources only)
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
 * Generate a unique key for a resource to match between base and head
 * Uses type + sku + region as a composite key since ARM compiled output
 * may not preserve original Bicep symbolic names
 * @param resource - Resource metadata
 * @returns Unique key string
 */
function getResourceKey(resource: ResourceMetadata): string {
  // For resources of the same type, we need a way to match them
  // Since ARM templates don't preserve Bicep symbolic names,
  // we use type as primary key. For multiple resources of same type,
  // we include sku and region to differentiate them.
  const parts = [resource.type];

  // Only include sku/region in key if present, to avoid false negatives
  // when comparing resources with missing optional fields
  if (resource.sku) {
    parts.push(resource.sku);
  }
  if (resource.region) {
    parts.push(resource.region);
  }

  return parts.join('|');
}

/**
 * Generate a simpler key using just the resource type
 * Used for matching when the composite key doesn't find a match
 * @param resource - Resource metadata
 * @returns Type-only key string
 */
function getTypeOnlyKey(resource: ResourceMetadata): string {
  return resource.type;
}

/**
 * Check if two resources have meaningful changes
 * @param base - Base version of resource
 * @param head - Head version of resource
 * @returns True if resources have changes worth reporting
 */
function hasChanges(base: ResourceMetadata, head: ResourceMetadata): boolean {
  // SKU change is always significant (affects cost)
  if (base.sku !== head.sku) {
    return true;
  }

  // Region change is significant (affects cost and compliance)
  if (base.region !== head.region) {
    return true;
  }

  // Shard count change is significant for Redis Premium (affects cost)
  if (base.shardCount !== head.shardCount) {
    return true;
  }
  if (base.osType !== head.osType) {
    return true;
  }
  if (base.licenseType !== head.licenseType) {
    return true;
  }
  if (base.highAvailability !== head.highAvailability) {
    return true;
  }
  if (base.messagingUnits !== head.messagingUnits) {
    return true;
  }
  if (base.capacityUnits !== head.capacityUnits) {
    return true;
  }
  return false;
}

/**
 * Diff resources between base branch and head branch versions
 * Detects added, removed, and modified resources at the individual level
 * @param baseResources - Resources from base branch (e.g., main)
 * @param headResources - Resources from head branch (PR)
 * @returns Array of resource diffs with change information
 */
export function diffResources(
  baseResources: ResourceMetadata[],
  headResources: ResourceMetadata[]
): DiffResult {
  log.debug(`Diffing resources: ${baseResources.length} base, ${headResources.length} head`);

  const diffs: ResourceDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  // Create maps for both detailed and type-only matching
  const baseMap = new Map<string, ResourceMetadata>();
  const baseTypeMap = new Map<string, ResourceMetadata[]>();

  for (const resource of baseResources) {
    baseMap.set(getResourceKey(resource), resource);

    const typeKey = getTypeOnlyKey(resource);
    const existing = baseTypeMap.get(typeKey);
    if (existing) {
      existing.push(resource);
    } else {
      baseTypeMap.set(typeKey, [resource]);
    }
  }

  const headMap = new Map<string, ResourceMetadata>();
  const headTypeMap = new Map<string, ResourceMetadata[]>();

  for (const resource of headResources) {
    headMap.set(getResourceKey(resource), resource);

    const typeKey = getTypeOnlyKey(resource);
    const existing = headTypeMap.get(typeKey);
    if (existing) {
      existing.push(resource);
    } else {
      headTypeMap.set(typeKey, [resource]);
    }
  }

  // Track which base resources have been matched
  const matchedBaseKeys = new Set<string>();

  // Find added and modified resources (iterate over head)
  for (const [key, headResource] of headMap) {
    const baseResource = baseMap.get(key);

    if (!baseResource) {
      // Try to find by type only (handles SKU/region changes)
      const typeKey = getTypeOnlyKey(headResource);
      const baseByType = baseTypeMap.get(typeKey);

      if (baseByType && baseByType.length > 0) {
        // Found a resource of same type - check if it's a modification
        // Find the first unmatched base resource of this type
        const unmatchedBase = baseByType.find(b => !matchedBaseKeys.has(getResourceKey(b)));

        if (unmatchedBase) {
          matchedBaseKeys.add(getResourceKey(unmatchedBase));

          if (hasChanges(unmatchedBase, headResource)) {
            // Resource was modified (SKU or region changed)
            diffs.push({
              type: headResource.type,
              kind: headResource.kind,
              change: 'modified',
              tier: headResource.tier,
              oldSku: unmatchedBase.sku,
              newSku: headResource.sku,
              oldRegion: unmatchedBase.region,
              newRegion: headResource.region,
              oldShardCount: unmatchedBase.shardCount,
              newShardCount: headResource.shardCount,
              properties: headResource.properties,
              tags: headResource.tags,
              osType: headResource.osType,
              oldOsType: unmatchedBase.osType,
              licenseType: headResource.licenseType,
              oldLicenseType: unmatchedBase.licenseType,
              highAvailability: headResource.highAvailability,
              oldHighAvailability: unmatchedBase.highAvailability,
              messagingUnits: headResource.messagingUnits,
              oldMessagingUnits: unmatchedBase.messagingUnits,
              capacityUnits: headResource.capacityUnits,
              oldCapacityUnits: unmatchedBase.capacityUnits,
            });
            modified++;
            log.debug(`Modified: ${headResource.type} (${unmatchedBase.sku} -> ${headResource.sku})`);
          } else {
            // No meaningful changes
            unchanged++;
          }
          continue;
        }
      }

      // Resource exists in head but not in base = ADDED
      diffs.push({
        type: headResource.type,
        kind: headResource.kind,
        change: 'added',
        tier: headResource.tier,
        newSku: headResource.sku,
        newRegion: headResource.region,
        newShardCount: headResource.shardCount,
        properties: headResource.properties,
        tags: headResource.tags,
        osType: headResource.osType,
        licenseType: headResource.licenseType,
        highAvailability: headResource.highAvailability,
        messagingUnits: headResource.messagingUnits,
        capacityUnits: headResource.capacityUnits,
      });
      added++;
      log.debug(`Added: ${headResource.type} (${headResource.sku || 'no sku'})`);
    } else {
      // Exact key match found
      matchedBaseKeys.add(key);

      if (hasChanges(baseResource, headResource)) {
        // Resource exists in both but has changes = MODIFIED
        diffs.push({
          type: headResource.type,
          kind: headResource.kind,
          change: 'modified',
          tier: headResource.tier,
          oldSku: baseResource.sku,
          newSku: headResource.sku,
          oldRegion: baseResource.region,
          newRegion: headResource.region,
          oldShardCount: baseResource.shardCount,
          newShardCount: headResource.shardCount,
          properties: headResource.properties,
          tags: headResource.tags,
          osType: headResource.osType,
          oldOsType: baseResource.osType,
          licenseType: headResource.licenseType,
          oldLicenseType: baseResource.licenseType,
          highAvailability: headResource.highAvailability,
          oldHighAvailability: baseResource.highAvailability,
          messagingUnits: headResource.messagingUnits,
          oldMessagingUnits: baseResource.messagingUnits,
          capacityUnits: headResource.capacityUnits,
          oldCapacityUnits: baseResource.capacityUnits,
        });
        modified++;
        log.debug(`Modified: ${headResource.type} (${baseResource.sku} -> ${headResource.sku})`);
      } else {
        // No meaningful changes, skip
        unchanged++;
      }
    }
  }

  // Find removed resources (in base but not in head)
  for (const [key, baseResource] of baseMap) {
    if (!matchedBaseKeys.has(key)) {
      // Check if there's any head resource of the same type
      const typeKey = getTypeOnlyKey(baseResource);
      const headByType = headTypeMap.get(typeKey);

      // If no resources of this type exist in head, it's definitely removed
      if (!headByType || headByType.length === 0) {
        diffs.push({
          type: baseResource.type,
          kind: baseResource.kind,
          change: 'removed',
          tier: baseResource.tier,
          oldSku: baseResource.sku,
          oldRegion: baseResource.region,
          oldShardCount: baseResource.shardCount,
          tags: baseResource.tags,
          osType: baseResource.osType,
          licenseType: baseResource.licenseType,
          highAvailability: baseResource.highAvailability,
          messagingUnits: baseResource.messagingUnits,
          capacityUnits: baseResource.capacityUnits,
        });
        removed++;
        log.debug(`Removed: ${baseResource.type} (${baseResource.sku || 'no sku'})`);
      }
      // If there are head resources of same type but they didn't match,
      // we've already handled them as modifications above
    }
  }

  log.debug(`Diff complete: +${added} added, -${removed} removed, ~${modified} modified, ${unchanged} unchanged`);

  return {
    diffs,
    added,
    removed,
    modified,
    unchanged,
  };
}
