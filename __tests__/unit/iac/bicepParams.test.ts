import { parseBicepParamFile } from '../../../src/iac/bicepParams';

describe('parseBicepParamFile', () => {
  describe('basic param extraction', () => {
    it('should parse string params with single quotes', () => {
      const content = `using '../main.bicep'\n\nparam location = 'westeurope'`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse string params with double quotes', () => {
      const content = `using '../main.bicep'\n\nparam location = "westeurope"`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse boolean params', () => {
      const content = `param enableHA = true\nparam debugMode = false`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ enableHA: true, debugMode: false });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse boolean params case-insensitively', () => {
      const content = `param flag = True\nparam other = FALSE`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ flag: true, other: false });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse integer params', () => {
      const content = `param instanceCount = 3`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ instanceCount: 3 });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse negative integer params', () => {
      const content = `param offset = -1`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ offset: -1 });
      expect(result.errors).toHaveLength(0);
    });

    it('should parse multiple params', () => {
      const content = [
        "using '../main.bicep'",
        '',
        "param location = 'westeurope'",
        "param secondaryLocation = 'northeurope'",
        "param env = 'dev'",
        'param instanceCount = 2',
        'param enableMonitoring = true',
      ].join('\n');

      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({
        location: 'westeurope',
        secondaryLocation: 'northeurope',
        env: 'dev',
        instanceCount: 2,
        enableMonitoring: true,
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('using directive', () => {
    it('should skip the using line', () => {
      const content = `using '../main.bicep'\nparam location = 'westeurope'`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
    });

    it('should skip using with double quotes', () => {
      const content = `using "../main.bicep"\nparam x = 1`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ x: 1 });
    });
  });

  describe('comments', () => {
    it('should strip line comments', () => {
      const content = `param location = 'westeurope' // primary region`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
    });

    it('should skip full-line comments', () => {
      const content = [
        "// This is a comment",
        "param location = 'westeurope'",
      ].join('\n');
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
    });

    it('should not strip // inside single-quoted strings', () => {
      const content = `param url = 'https://example.com'`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ url: 'https://example.com' });
    });

    it('should not strip // inside double-quoted strings', () => {
      const content = `param url = "https://example.com"`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ url: 'https://example.com' });
    });
  });

  describe('whitespace and formatting', () => {
    it('should handle extra whitespace around equals', () => {
      const content = `param location   =   'westeurope'`;
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
    });

    it('should handle Windows-style line endings', () => {
      const content = "param a = 'one'\r\nparam b = 'two'\r\n";
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ a: 'one', b: 'two' });
    });

    it('should skip empty lines', () => {
      const content = "\n\nparam x = 1\n\n\nparam y = 2\n";
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ x: 1, y: 2 });
    });
  });

  describe('param name validation', () => {
    it('should accept underscored param names', () => {
      const content = `param my_location = 'westeurope'`;
      const result = parseBicepParamFile(content);
      expect(result.params).toHaveProperty('my_location');
    });

    it('should accept param names starting with underscore', () => {
      const content = `param _internal = 1`;
      const result = parseBicepParamFile(content);
      expect(result.params).toHaveProperty('_internal');
    });
  });

  describe('unsupported values', () => {
    it('should report error for array values', () => {
      const content = `param regions = ['westeurope', 'northeurope']`;
      const result = parseBicepParamFile(content);
      expect(result.params).not.toHaveProperty('regions');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('unsupported value');
      expect(result.errors[0]).toContain('regions');
    });

    it('should report error for object values', () => {
      const content = `param tags = { env: 'dev' }`;
      const result = parseBicepParamFile(content);
      expect(result.params).not.toHaveProperty('tags');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('unsupported value');
    });

    it('should continue parsing after unsupported value', () => {
      const content = [
        "param location = 'westeurope'",
        "param tags = { env: 'dev' }",
        "param count = 3",
      ].join('\n');
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope', count: 3 });
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('empty and edge cases', () => {
    it('should return empty result for empty file', () => {
      const result = parseBicepParamFile('');
      expect(result.params).toEqual({});
      expect(result.errors).toHaveLength(0);
    });

    it('should return empty result for file with only using directive', () => {
      const result = parseBicepParamFile("using '../main.bicep'");
      expect(result.params).toEqual({});
      expect(result.errors).toHaveLength(0);
    });

    it('should return empty result for file with only comments', () => {
      const content = "// comment one\n// comment two\n";
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({});
      expect(result.errors).toHaveLength(0);
    });

    it('should ignore non-param lines', () => {
      const content = [
        "using '../main.bicep'",
        "var something = 'test'",
        "param location = 'westeurope'",
        "random text here",
      ].join('\n');
      const result = parseBicepParamFile(content);
      expect(result.params).toEqual({ location: 'westeurope' });
      expect(result.errors).toHaveLength(0);
    });
  });
});
