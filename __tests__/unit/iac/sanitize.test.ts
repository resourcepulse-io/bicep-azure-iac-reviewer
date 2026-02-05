import {
  sanitizeResources,
  validateNoSensitiveData,
} from '../../../src/iac/sanitize';
import { ResourceMetadata } from '../../../src/iac/armExtract';

// Helper function to check if a property was removed from safe properties
function expectPropertyRemoved(
  safeProperties: Record<string, unknown> | undefined,
  propertyName: string
): void {
  if (safeProperties === undefined) {
    // All properties removed - this is valid
    expect(true).toBe(true);
  } else {
    expect(safeProperties).not.toHaveProperty(propertyName);
  }
}

describe('sanitizeResources', () => {
  describe('Privacy Contract - Must Strip Sensitive Data', () => {
    it('should remove resource name field', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            name: 'my-production-vm',
            vmSize: 'Standard_D2s_v3',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('name');
      expect(result.resources[0].safeProperties).not.toHaveProperty('name');
    });

    it('should remove resource id field', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            id: '/subscriptions/abc123/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/mystorageacct',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('id');
      expectPropertyRemoved(result.resources[0].safeProperties, 'id');
    });

    it('should remove resourceId field', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Web/sites',
          kind: 'Microsoft.Web/sites',
          properties: {
            resourceId:
              '/subscriptions/xyz/resourceGroups/mygroup/providers/Microsoft.Web/sites/myapp',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('resourceId');
      expectPropertyRemoved(result.resources[0].safeProperties, 'resourceId');
    });

    it('should remove dependsOn arrays', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            dependsOn: [
              'Microsoft.Network/networkInterfaces/nic1',
              'Microsoft.Storage/storageAccounts/storage1',
            ],
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('dependsOn');
      expectPropertyRemoved(result.resources[0].safeProperties, 'dependsOn');
    });

    it('should keep tag keys with empty values', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            tags: {
              owner: 'john.doe@company.com',
              project: 'secret-project',
              costCenter: 'CC-12345',
            },
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].tags).toEqual({
        owner: '',
        project: '',
        costCenter: '',
      });
      expect(result.resources[0].safeProperties?.tags).toBeUndefined();
    });

    it('should remove connection strings', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Sql/servers/databases',
          kind: 'Microsoft.Sql/servers/databases',
          properties: {
            connectionString:
              'Server=tcp:myserver.database.windows.net;Database=mydb;User ID=admin;Password=P@ssw0rd;',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('connectionString');
      expectPropertyRemoved(result.resources[0].safeProperties, 'connectionString');
    });

    it('should remove password fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Sql/servers',
          kind: 'Microsoft.Sql/servers',
          properties: {
            administratorLogin: 'admin',
            administratorPassword: 'SuperSecret123!',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('administratorPassword');
      expect(result.resources[0].safeProperties).not.toHaveProperty(
        'administratorPassword'
      );
    });

    it('should remove secret fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.KeyVault/vaults',
          kind: 'Microsoft.KeyVault/vaults',
          properties: {
            secretValue: 'my-secret-value',
            clientSecret: 'abc123def456',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('secretValue');
      expect(result.removedFields).toContain('clientSecret');
      expectPropertyRemoved(result.resources[0].safeProperties, 'secretValue');
      expectPropertyRemoved(result.resources[0].safeProperties, 'clientSecret');
    });

    it('should remove key fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            primaryKey: 'base64encodedkey==',
            apiKey: 'sk-1234567890abcdef',
            accessKey: 'another-key',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('primaryKey');
      expect(result.removedFields).toContain('apiKey');
      expect(result.removedFields).toContain('accessKey');
    });

    it('should remove credential fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            credentials: {
              username: 'admin',
              password: 'P@ssw0rd',
            },
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('credentials');
      expectPropertyRemoved(result.resources[0].safeProperties, 'credentials');
    });

    it('should remove Azure identity fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.ManagedIdentity/userAssignedIdentities',
          kind: 'Microsoft.ManagedIdentity/userAssignedIdentities',
          properties: {
            principalId: '12345678-1234-1234-1234-123456789012',
            tenantId: '87654321-4321-4321-4321-210987654321',
            clientId: 'abcdef12-3456-7890-abcd-ef1234567890',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('principalId');
      expect(result.removedFields).toContain('tenantId');
      expect(result.removedFields).toContain('clientId');
    });

    it('should remove subscription ID fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Resources/resourceGroups',
          kind: 'Microsoft.Resources/resourceGroups',
          properties: {
            subscriptionId: '12345678-1234-1234-1234-123456789012',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('subscriptionId');
      expectPropertyRemoved(result.resources[0].safeProperties, 'subscriptionId');
    });

    it('should remove nested sensitive fields', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            osProfile: {
              computerName: 'my-vm-hostname',
              adminUsername: 'admin',
              adminPassword: 'P@ssw0rd123',
            },
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Nested sensitive fields should be removed
      const osProfile = result.resources[0].safeProperties
        ?.osProfile as Record<string, unknown> | undefined;
      if (osProfile) {
        expect(osProfile).not.toHaveProperty('computerName');
        expect(osProfile).not.toHaveProperty('adminPassword');
      }
      // Test passes if osProfile is removed entirely or if nested fields are removed
    });

    it('should remove fields containing sensitive substrings', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            storageAccountKey: 'key123',
            accountSecret: 'secret456',
            tokenValue: 'token789',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expectPropertyRemoved(result.resources[0].safeProperties, 'storageAccountKey');
      expectPropertyRemoved(result.resources[0].safeProperties, 'accountSecret');
      expectPropertyRemoved(result.resources[0].safeProperties, 'tokenValue');
    });
  });

  describe('Privacy Contract - Must Preserve Safe Data', () => {
    it('should preserve SKU information', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          sku: 'Standard_D2s_v3',
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].sku).toBe('Standard_D2s_v3');
    });

    it('should preserve region information', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          region: 'eastus',
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].region).toBe('eastus');
    });

    it('should preserve resource type and kind', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].type).toBe('Microsoft.Compute/virtualMachines');
      expect(result.resources[0].kind).toBe('Microsoft.Compute/virtualMachines');
    });

    it('should preserve API version', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          apiVersion: '2023-01-01',
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].apiVersion).toBe('2023-01-01');
    });

    it('should preserve numeric properties', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            cores: 4,
            memory: 16384,
            diskSize: 128,
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].safeProperties?.cores).toBe(4);
      expect(result.resources[0].safeProperties?.memory).toBe(16384);
      expect(result.resources[0].safeProperties?.diskSize).toBe(128);
    });

    it('should preserve boolean properties', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            enabled: true,
            publicAccess: false,
            httpsOnly: true,
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].safeProperties?.enabled).toBe(true);
      expect(result.resources[0].safeProperties?.publicAccess).toBe(false);
      expect(result.resources[0].safeProperties?.httpsOnly).toBe(true);
    });

    it('should preserve safe enum-like strings', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            status: 'enabled',
            accessTier: 'Hot',
            redundancy: 'LRS',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].safeProperties?.status).toBe('enabled');
      expect(result.resources[0].safeProperties?.accessTier).toBe('Hot');
      expect(result.resources[0].safeProperties?.redundancy).toBe('LRS');
    });

    it('should preserve safe property keys from whitelist', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Web/serverfarms',
          kind: 'Microsoft.Web/serverfarms',
          properties: {
            capacity: 2,
            tier: 'Standard',
            size: 'S1',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].safeProperties?.capacity).toBe(2);
      expect(result.resources[0].safeProperties?.tier).toBe('Standard');
      expect(result.resources[0].safeProperties?.size).toBe('S1');
    });

    it('should preserve null values', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            customDomain: null,
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources[0].safeProperties?.customDomain).toBeNull();
    });
  });

  describe('Pattern Detection Tests', () => {
    it('should detect and remove GUID patterns', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            resourceGuid: '12345678-1234-1234-1234-123456789012',
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Field should be removed due to GUID content
      expectPropertyRemoved(result.resources[0].safeProperties, 'resourceGuid');
    });

    it('should detect and remove Azure resource ID patterns', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Network/virtualNetworks',
          kind: 'Microsoft.Network/virtualNetworks',
          properties: {
            subnetRef:
              '/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/subnet1',
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Field should be removed due to resource ID pattern
      expectPropertyRemoved(result.resources[0].safeProperties, 'subnetRef');
    });

    it('should detect and remove connection string patterns', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            primaryConnectionString:
              'DefaultEndpointsProtocol=https;AccountName=mystorageacct;AccountKey=abc123==;EndpointSuffix=core.windows.net',
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Field should be removed due to connection string pattern
      expectPropertyRemoved(result.resources[0].safeProperties, 'primaryConnectionString');
    });

    it('should detect and remove long base64 strings (potential secrets)', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            storageKey:
              'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Field should be removed due to long base64 pattern
      expectPropertyRemoved(result.resources[0].safeProperties, 'storageKey');
    });

    it('should remove strings longer than 50 characters (likely identifiers)', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            description:
              'This is a very long description that contains identifying information about our production storage account',
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Long string should be removed
      expectPropertyRemoved(result.resources[0].safeProperties, 'description');
    });

    it('should remove arrays containing sensitive values', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Network/networkSecurityGroups',
          kind: 'Microsoft.Network/networkSecurityGroups',
          properties: {
            allowedIpRanges: [
              '10.0.0.0/24',
              '192.168.1.0/24',
              'my-custom-network-name',
            ],
          },
        },
      ];

      const result = sanitizeResources(resources);

      // Array should be removed because it contains non-safe strings
      expectPropertyRemoved(result.resources[0].safeProperties, 'allowedIpRanges');
    });
  });

  describe('validateNoSensitiveData', () => {
    it('should detect GUID in output', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            properties: {
              id: '12345678-1234-1234-1234-123456789012',
            },
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
      expect(validation.violations.some((v) => v.includes('GUID'))).toBe(true);
    });

    it('should detect resource ID pattern in output', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            ref: '/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/storage1',
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
      expect(
        validation.violations.some((v) => v.includes('Resource ID'))
      ).toBe(true);
    });

    it('should detect forbidden field names', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Storage/storageAccounts',
            name: 'my-storage-account',
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
      expect(
        validation.violations.some((v) => v.includes('Forbidden field'))
      ).toBe(true);
    });

    it('should detect connection strings in output', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Sql/servers/databases',
            connection:
              'Server=tcp:myserver.database.windows.net;AccountName=user;',
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
      expect(
        validation.violations.some((v) => v.includes('Connection string'))
      ).toBe(true);
    });

    it('should pass validation for clean data', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Compute/virtualMachines',
            kind: 'Microsoft.Compute/virtualMachines',
            sku: 'Standard_D2s_v3',
            region: 'eastus',
            properties: {
              cores: 4,
              memory: 16384,
              enabled: true,
            },
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);
    });

    it('should detect sensitive data in nested structures', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Compute/virtualMachines',
            kind: 'Microsoft.Compute/virtualMachines',
            properties: {
              network: {
                config: {
                  resourceId:
                    '/subscriptions/xyz/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet1',
                },
              },
            },
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
    });

    it('should detect sensitive data in arrays', () => {
      const data = {
        resources: [
          {
            type: 'Microsoft.Network/networkSecurityGroups',
            kind: 'Microsoft.Network/networkSecurityGroups',
            rules: [
              {
                id: '12345678-1234-1234-1234-123456789012',
              },
            ],
          },
        ],
      };

      const validation = validateNoSensitiveData(data);

      expect(validation.valid).toBe(false);
      expect(validation.violations.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty resource array', () => {
      const resources: ResourceMetadata[] = [];

      const result = sanitizeResources(resources);

      expect(result.resources).toEqual([]);
      expect(result.resourceCount).toBe(0);
      expect(result.removedFields).toEqual([]);
    });

    it('should handle resource with no properties', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toEqual({
        type: 'Microsoft.Storage/storageAccounts',
        kind: 'Microsoft.Storage/storageAccounts',
        count: 1,
        change: 'modified',
      });
    });

    it('should handle resource with empty properties object', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {},
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].safeProperties).toBeUndefined();
    });

    it('should handle multiple resources', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          sku: 'Standard_D2s_v3',
        },
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          region: 'eastus',
        },
        {
          type: 'Microsoft.Web/sites',
          kind: 'Microsoft.Web/sites',
          properties: {
            enabled: true,
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.resources).toHaveLength(3);
      expect(result.resourceCount).toBe(3);
    });

    it('should track all unique removed fields across multiple resources', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            name: 'vm1',
            id: 'id1',
          },
        },
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            name: 'storage1',
            password: 'secret',
          },
        },
      ];

      const result = sanitizeResources(resources);

      expect(result.removedFields).toContain('name');
      expect(result.removedFields).toContain('id');
      expect(result.removedFields).toContain('password');
      // Should be unique
      expect(result.removedFields.filter((f) => f === 'name')).toHaveLength(1);
    });
  });

  describe('Contract Validation Integration Tests', () => {
    it('sanitized output should always pass validation', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          sku: 'Standard_D2s_v3',
          region: 'eastus',
          apiVersion: '2023-01-01',
          properties: {
            name: 'my-production-vm',
            id: '12345678-1234-1234-1234-123456789012',
            resourceId:
              '/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
            cores: 4,
            memory: 16384,
            enabled: true,
            password: 'SuperSecret123!',
            dependsOn: ['resource1', 'resource2'],
          },
        },
        {
          type: 'Microsoft.Storage/storageAccounts',
          kind: 'Microsoft.Storage/storageAccounts',
          properties: {
            name: 'mystorageacct',
            connectionString: 'AccountName=test;AccountKey=abc123;',
            accessKey: 'key123',
            replication: 'LRS',
          },
        },
      ];

      const sanitized = sanitizeResources(resources);
      const validation = validateNoSensitiveData(sanitized);

      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);
    });

    it('should never leak PII even with malicious input', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            // Try to sneak in sensitive data with various naming schemes
            user_name: 'admin@company.com',
            userName: 'admin',
            'user-name': 'admin',
            config_password: 'P@ssw0rd',
            configPassword: 'secret',
            nested: {
              secret_key: 'abc123',
              secretKey: 'def456',
            },
            subscriptionid: '12345678-1234-1234-1234-123456789012',
            SUBSCRIPTIONID: '87654321-4321-4321-4321-210987654321',
          },
        },
      ];

      const sanitized = sanitizeResources(resources);
      const validation = validateNoSensitiveData(sanitized);

      // All sensitive data should be removed
      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);

      // Verify specific fields are gone
      const props = sanitized.resources[0].safeProperties;
      expectPropertyRemoved(props, 'user_name');
      expectPropertyRemoved(props, 'userName');
      expectPropertyRemoved(props, 'config_password');
      expectPropertyRemoved(props, 'configPassword');
      expectPropertyRemoved(props, 'subscriptionid');
      expectPropertyRemoved(props, 'SUBSCRIPTIONID');
    });

    it('should handle deeply nested structures safely', () => {
      const resources: ResourceMetadata[] = [
        {
          type: 'Microsoft.Compute/virtualMachines',
          kind: 'Microsoft.Compute/virtualMachines',
          properties: {
            level1: {
              cores: 4,
              level2: {
                memory: 16384,
                level3: {
                  enabled: true,
                  level4: {
                    tier: 'Premium',
                    password: 'this-should-be-removed',
                  },
                },
              },
            },
          },
        },
      ];

      const sanitized = sanitizeResources(resources);
      const validation = validateNoSensitiveData(sanitized);

      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);

      // Verify safe nested data is preserved
      const level1 = sanitized.resources[0].safeProperties?.level1 as Record<
        string,
        unknown
      >;
      expect(level1?.cores).toBe(4);

      // Verify sensitive nested data is removed
      const level2 = level1?.level2 as Record<string, unknown>;
      const level3 = level2?.level3 as Record<string, unknown>;
      const level4 = level3?.level4 as Record<string, unknown>;
      expect(level4).not.toHaveProperty('password');
    });
  });
});
