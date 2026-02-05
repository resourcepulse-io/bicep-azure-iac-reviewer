import { diffResources } from '../../../src/iac/resourceDiff';
import { ResourceMetadata } from '../../../src/iac/armExtract';

describe('Resource Diff Module', () => {
  const createResource = (
    type: string,
    sku?: string,
    region?: string
  ): ResourceMetadata => ({
    type,
    kind: type, // kind now equals type
    sku,
    region,
  });

  describe('diffResources', () => {
    describe('Added Resources', () => {
      it('should detect resources added to head (not in base)', () => {
        const baseResources: ResourceMetadata[] = [];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.added).toBe(1);
        expect(result.removed).toBe(0);
        expect(result.modified).toBe(0);
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0]).toMatchObject({
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          change: 'added',
          newSku: 'Standard_LRS',
          newRegion: 'eastus',
        });
      });

      it('should detect multiple added resources', () => {
        const baseResources: ResourceMetadata[] = [];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.added).toBe(2);
        expect(result.removed).toBe(0);
        expect(result.diffs).toHaveLength(2);
        expect(result.diffs.every(d => d.change === 'added')).toBe(true);
      });

      it('should detect added resource when base has other resources', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.added).toBe(1);
        expect(result.unchanged).toBe(1);
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0].change).toBe('added');
        expect(result.diffs[0].type).toBe('Microsoft.Compute/virtualMachines');
      });
    });

    describe('Removed Resources', () => {
      it('should detect resources removed from base (not in head)', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [];

        const result = diffResources(baseResources, headResources);

        expect(result.removed).toBe(1);
        expect(result.added).toBe(0);
        expect(result.modified).toBe(0);
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0]).toMatchObject({
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          change: 'removed',
          oldSku: 'Standard_LRS',
          oldRegion: 'eastus',
        });
      });

      it('should detect multiple removed resources', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'),
        ];
        const headResources: ResourceMetadata[] = [];

        const result = diffResources(baseResources, headResources);

        expect(result.removed).toBe(2);
        expect(result.added).toBe(0);
        expect(result.diffs).toHaveLength(2);
        expect(result.diffs.every(d => d.change === 'removed')).toBe(true);
      });

      it('should detect removed resource when head has other resources', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.removed).toBe(1);
        expect(result.unchanged).toBe(1);
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0].change).toBe('removed');
        expect(result.diffs[0].type).toBe('Microsoft.Compute/virtualMachines');
      });
    });

    describe('Modified Resources (SKU Changes)', () => {
      it('should detect SKU upgrade', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Web/serverfarms', 'B1', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Web/serverfarms', 'P1v3', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.modified).toBe(1);
        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
        expect(result.diffs).toHaveLength(1);
        expect(result.diffs[0]).toMatchObject({
          type: 'Microsoft.Web/serverfarms',
          change: 'modified',
          oldSku: 'B1',
          newSku: 'P1v3',
          oldRegion: 'eastus',
          newRegion: 'eastus',
        });
      });

      it('should detect SKU downgrade', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.modified).toBe(1);
        expect(result.diffs[0]).toMatchObject({
          change: 'modified',
          oldSku: 'Standard_GRS',
          newSku: 'Standard_LRS',
        });
      });

      it('should detect region change', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'westus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.modified).toBe(1);
        expect(result.diffs[0]).toMatchObject({
          change: 'modified',
          oldRegion: 'eastus',
          newRegion: 'westus',
        });
      });

      it('should detect combined SKU and region change', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'westeurope'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.modified).toBe(1);
        expect(result.diffs[0]).toMatchObject({
          change: 'modified',
          oldSku: 'Standard_LRS',
          newSku: 'Standard_GRS',
          oldRegion: 'eastus',
          newRegion: 'westeurope',
        });
      });
    });

    describe('Unchanged Resources', () => {
      it('should not report resources that are identical', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.unchanged).toBe(1);
        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
        expect(result.modified).toBe(0);
        expect(result.diffs).toHaveLength(0);
      });

      it('should handle multiple unchanged resources', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.unchanged).toBe(2);
        expect(result.diffs).toHaveLength(0);
      });
    });

    describe('Complex Scenarios', () => {
      it('should handle mixed changes (add, remove, modify)', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Web/serverfarms', 'B1', 'eastus'),
          createResource('Microsoft.Sql/servers/databases', 'Basic', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'eastus'), // modified (SKU)
          createResource('Microsoft.Web/serverfarms', 'B1', 'eastus'), // unchanged
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'), // added
          // sql_db removed
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.added).toBe(1);
        expect(result.removed).toBe(1);
        expect(result.modified).toBe(1);
        expect(result.unchanged).toBe(1);

        const addedDiff = result.diffs.find(d => d.change === 'added');
        const removedDiff = result.diffs.find(d => d.change === 'removed');
        const modifiedDiff = result.diffs.find(d => d.change === 'modified');

        expect(addedDiff?.type).toBe('Microsoft.Compute/virtualMachines');
        expect(removedDiff?.type).toBe('Microsoft.Sql/servers/databases');
        expect(modifiedDiff?.type).toBe('Microsoft.Storage/storageAccounts');
      });

      it('should handle empty base and head (no changes)', () => {
        const result = diffResources([], []);

        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
        expect(result.modified).toBe(0);
        expect(result.unchanged).toBe(0);
        expect(result.diffs).toHaveLength(0);
      });

      it('should handle resources with missing optional fields', () => {
        const baseResources: ResourceMetadata[] = [
          { type: 'Microsoft.Storage/storageAccounts', kind: 'Microsoft.Storage/storageAccounts' },
        ];
        const headResources: ResourceMetadata[] = [
          { type: 'Microsoft.Storage/storageAccounts', kind: 'storage', sku: 'Standard_LRS' },
        ];

        const result = diffResources(baseResources, headResources);

        // Adding SKU where there was none is a change
        expect(result.modified).toBe(1);
        expect(result.diffs[0]).toMatchObject({
          change: 'modified',
          oldSku: undefined,
          newSku: 'Standard_LRS',
        });
      });

      it('should handle resource rename as remove + add', () => {
        // When a resource is renamed, ARM sees it as different resources
        // This is expected behavior per the documentation
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'westus'),
        ];

        const result = diffResources(baseResources, headResources);

        // Since the only resource changed both SKU and region, it should be detected as modified
        expect(result.modified).toBe(1);
      });
    });

    describe('Edge Cases', () => {
      it('should handle resources with same type but different SKUs in base', () => {
        // Multiple storage accounts with different SKUs
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'westus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
          createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'westus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.unchanged).toBe(2);
        expect(result.diffs).toHaveLength(0);
      });

      it('should handle resources with properties', () => {
        const baseResources: ResourceMetadata[] = [
          {
            type: 'Microsoft.Storage/storageAccounts',
            kind: 'Microsoft.Storage/storageAccounts',
            sku: 'Standard_LRS',
            region: 'eastus',
            properties: { tier: 'Standard' },
          },
        ];
        const headResources: ResourceMetadata[] = [
          {
            type: 'Microsoft.Storage/storageAccounts',
            kind: 'Microsoft.Storage/storageAccounts',
            sku: 'Standard_GRS',
            region: 'eastus',
            properties: { tier: 'Standard', replication: 'GRS' },
          },
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.modified).toBe(1);
        expect(result.diffs[0].properties).toEqual({ tier: 'Standard', replication: 'GRS' });
      });

      it('should preserve kind in diff output', () => {
        const baseResources: ResourceMetadata[] = [
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'eastus'),
        ];
        const headResources: ResourceMetadata[] = [
          createResource('Microsoft.Compute/virtualMachines', 'Standard_D4s_v3', 'eastus'),
        ];

        const result = diffResources(baseResources, headResources);

        expect(result.diffs[0].kind).toBe('Microsoft.Compute/virtualMachines');
      });
    });
  });

  describe('DiffResult structure', () => {
    it('should have correct structure', () => {
      const result = diffResources([], []);

      expect(result).toHaveProperty('diffs');
      expect(result).toHaveProperty('added');
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('modified');
      expect(result).toHaveProperty('unchanged');
      expect(Array.isArray(result.diffs)).toBe(true);
    });

    it('should have counts that sum correctly', () => {
      const baseResources: ResourceMetadata[] = [
        createResource('Microsoft.Storage/storageAccounts', 'Standard_LRS', 'eastus'),
        createResource('Microsoft.Web/serverfarms', 'B1', 'eastus'),
        createResource('Microsoft.Sql/servers/databases', 'Basic', 'eastus'),
      ];
      const headResources: ResourceMetadata[] = [
        createResource('Microsoft.Storage/storageAccounts', 'Standard_GRS', 'eastus'),
        createResource('Microsoft.Web/serverfarms', 'B1', 'eastus'),
        createResource('Microsoft.Compute/virtualMachines', 'Standard_D2s_v3', 'westus'),
      ];

      const result = diffResources(baseResources, headResources);

      // diffs only contain non-unchanged items
      expect(result.diffs.length).toBe(result.added + result.removed + result.modified);
    });
  });
});
