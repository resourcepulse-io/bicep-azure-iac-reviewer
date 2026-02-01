import { extractResourceMetadata } from '../../../src/iac/armExtract';

// Mock the log module
jest.mock('../../../src/utils/log', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

describe('ARM Extract Module', () => {
  describe('extractResourceMetadata', () => {
    it('should extract basic resource metadata', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
            name: 'mystorageaccount',
            location: 'eastus',
            sku: {
              name: 'Standard_LRS',
            },
            properties: {
              supportsHttpsTrafficOnly: true,
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(1);
      expect(result.kindsDetected).toEqual(['storage']);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toEqual({
        type: 'Microsoft.Storage/storageAccounts',
        kind: 'storage',
        sku: 'Standard_LRS',
        region: 'eastus',
        apiVersion: '2021-04-01',
        properties: {
          supportsHttpsTrafficOnly: true,
        },
      });
    });

    it('should map resource types to kinds correctly', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          { type: 'Microsoft.Compute/virtualMachines', apiVersion: '2021-03-01' },
          { type: 'Microsoft.Web/serverfarms', apiVersion: '2021-02-01' },
          { type: 'Microsoft.Web/sites', apiVersion: '2021-02-01' },
          { type: 'Microsoft.Sql/servers/databases', apiVersion: '2021-05-01' },
          { type: 'Microsoft.Storage/storageAccounts', apiVersion: '2021-04-01' },
          { type: 'Microsoft.Network/virtualNetworks', apiVersion: '2021-03-01' },
          { type: 'Microsoft.Network/networkSecurityGroups', apiVersion: '2021-03-01' },
          { type: 'Microsoft.Unknown/resource', apiVersion: '2021-01-01' },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(8);
      expect(result.resources[0].kind).toBe('vm');
      expect(result.resources[1].kind).toBe('appservice');
      expect(result.resources[2].kind).toBe('appservice');
      expect(result.resources[3].kind).toBe('sqldb');
      expect(result.resources[4].kind).toBe('storage');
      expect(result.resources[5].kind).toBe('vnet');
      expect(result.resources[6].kind).toBe('nsg');
      expect(result.resources[7].kind).toBe('other');
    });

    it('should extract SKU from sku.name', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Compute/virtualMachines',
            apiVersion: '2021-03-01',
            sku: {
              name: 'Standard_D2s_v3',
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].sku).toBe('Standard_D2s_v3');
    });

    it('should extract SKU from sku.tier', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Web/serverfarms',
            apiVersion: '2021-02-01',
            sku: {
              tier: 'Standard',
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].sku).toBe('Standard');
    });

    it('should extract SKU from properties.sku', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Web/sites',
            apiVersion: '2021-02-01',
            properties: {
              sku: 'S1',
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].sku).toBe('S1');
    });

    it('should extract SKU from properties.sku.name', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Sql/servers/databases',
            apiVersion: '2021-05-01',
            properties: {
              sku: {
                name: 'GP_Gen5_2',
              },
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].sku).toBe('GP_Gen5_2');
    });

    it('should prefer sku.name over sku.tier', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
            sku: {
              name: 'Standard_LRS',
              tier: 'Standard',
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].sku).toBe('Standard_LRS');
    });

    it('should handle resources without SKU', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Network/virtualNetworks',
            apiVersion: '2021-03-01',
            location: 'westus',
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0]).toEqual({
        type: 'Microsoft.Network/virtualNetworks',
        kind: 'vnet',
        region: 'westus',
        apiVersion: '2021-03-01',
      });
      expect(result.resources[0].sku).toBeUndefined();
    });

    it('should handle resources without location', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].region).toBeUndefined();
    });

    it('should handle resources without properties', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Network/networkSecurityGroups',
            apiVersion: '2021-03-01',
            location: 'eastus',
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].properties).toBeUndefined();
    });

    it('should handle nested resources', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Network/virtualNetworks',
            apiVersion: '2021-03-01',
            location: 'eastus',
            resources: [
              {
                type: 'Microsoft.Network/virtualNetworks/subnets',
                apiVersion: '2021-03-01',
              },
              {
                type: 'Microsoft.Network/virtualNetworks/subnets',
                apiVersion: '2021-03-01',
              },
            ],
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(3);
      expect(result.resources[0].kind).toBe('vnet');
      expect(result.resources[1].kind).toBe('other');
      expect(result.resources[2].kind).toBe('other');
    });

    it('should handle deeply nested resources', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Compute/virtualMachines',
            apiVersion: '2021-03-01',
            resources: [
              {
                type: 'Microsoft.Compute/virtualMachines/extensions',
                apiVersion: '2021-03-01',
                resources: [
                  {
                    type: 'Microsoft.Compute/virtualMachines/extensions/config',
                    apiVersion: '2021-03-01',
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(3);
      expect(result.resources[0].kind).toBe('vm');
      expect(result.resources[1].kind).toBe('other');
      expect(result.resources[2].kind).toBe('other');
    });

    it('should handle empty resources array', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(0);
      expect(result.resources).toHaveLength(0);
      expect(result.kindsDetected).toHaveLength(0);
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = 'not valid json';

      expect(() => extractResourceMetadata(invalidJson)).toThrow(
        'Failed to parse ARM JSON'
      );
    });

    it('should throw error if resources is missing', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
      });

      expect(() => extractResourceMetadata(armJson)).toThrow(
        'ARM template is missing resources array'
      );
    });

    it('should throw error if resources is not an array', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: 'not an array',
      });

      expect(() => extractResourceMetadata(armJson)).toThrow(
        'ARM template is missing resources array or resources is not an array'
      );
    });

    it('should handle malformed resources gracefully', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          null,
          'invalid',
          123,
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      // Should skip null, string, and number, only process valid object
      expect(result.resourceCount).toBe(1);
      expect(result.resources[0].kind).toBe('storage');
    });

    it('should handle resources without type', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            apiVersion: '2021-04-01',
            location: 'eastus',
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(1);
      expect(result.resources[0].type).toBe('unknown');
      expect(result.resources[0].kind).toBe('other');
    });

    it('should detect multiple unique kinds', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          { type: 'Microsoft.Compute/virtualMachines', apiVersion: '2021-03-01' },
          { type: 'Microsoft.Compute/virtualMachines', apiVersion: '2021-03-01' },
          { type: 'Microsoft.Storage/storageAccounts', apiVersion: '2021-04-01' },
          { type: 'Microsoft.Network/virtualNetworks', apiVersion: '2021-03-01' },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(4);
      expect(result.kindsDetected).toHaveLength(3);
      expect(result.kindsDetected).toContain('vm');
      expect(result.kindsDetected).toContain('storage');
      expect(result.kindsDetected).toContain('vnet');
    });

    it('should extract properties as shallow copy', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
            properties: {
              supportsHttpsTrafficOnly: true,
              minimumTlsVersion: 'TLS1_2',
              allowBlobPublicAccess: false,
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resources[0].properties).toEqual({
        supportsHttpsTrafficOnly: true,
        minimumTlsVersion: 'TLS1_2',
        allowBlobPublicAccess: false,
      });
    });

    it('should handle complex ARM template with multiple resource types', () => {
      const armJson = JSON.stringify({
        $schema:
          'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        resources: [
          {
            type: 'Microsoft.Network/virtualNetworks',
            apiVersion: '2021-03-01',
            name: 'myVnet',
            location: 'eastus',
            properties: {
              addressSpace: {
                addressPrefixes: ['10.0.0.0/16'],
              },
            },
            resources: [
              {
                type: 'Microsoft.Network/virtualNetworks/subnets',
                apiVersion: '2021-03-01',
                name: 'default',
              },
            ],
          },
          {
            type: 'Microsoft.Compute/virtualMachines',
            apiVersion: '2021-03-01',
            name: 'myVM',
            location: 'eastus',
            sku: {
              name: 'Standard_D2s_v3',
              tier: 'Standard',
            },
            properties: {
              hardwareProfile: {
                vmSize: 'Standard_D2s_v3',
              },
            },
          },
          {
            type: 'Microsoft.Storage/storageAccounts',
            apiVersion: '2021-04-01',
            name: 'mystorageacct',
            location: 'eastus',
            sku: {
              name: 'Standard_LRS',
            },
            properties: {
              supportsHttpsTrafficOnly: true,
            },
          },
        ],
      });

      const result = extractResourceMetadata(armJson);

      expect(result.resourceCount).toBe(4);
      expect(result.kindsDetected).toContain('vnet');
      expect(result.kindsDetected).toContain('vm');
      expect(result.kindsDetected).toContain('storage');
      expect(result.kindsDetected).toContain('other');

      // Check vnet
      expect(result.resources[0].kind).toBe('vnet');
      expect(result.resources[0].region).toBe('eastus');
      expect(result.resources[0].properties?.addressSpace).toBeDefined();

      // Check nested subnet
      expect(result.resources[1].kind).toBe('other');

      // Check VM
      expect(result.resources[2].kind).toBe('vm');
      expect(result.resources[2].sku).toBe('Standard_D2s_v3');
      expect(result.resources[2].region).toBe('eastus');

      // Check storage
      expect(result.resources[3].kind).toBe('storage');
      expect(result.resources[3].sku).toBe('Standard_LRS');
      expect(result.resources[3].region).toBe('eastus');
    });
  });
});
