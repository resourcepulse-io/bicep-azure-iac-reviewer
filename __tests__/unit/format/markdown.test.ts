import {
  formatPRComment,
  hasMarker,
  extractContent,
  COMMENT_MARKER,
} from '../../../src/format/markdown';
import { AnalysisResult } from '../../../src/backend/client';

describe('markdown formatter', () => {
  describe('formatPRComment', () => {
    it('should include comment marker', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '## Test Analysis\nThis is a test.',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted.startsWith(COMMENT_MARKER)).toBe(true);
    });

    it('should include analysis markdown from backend response', () => {
      const backendMarkdown = '## Cost Analysis\n\nEstimated cost: $100/month\n\n- VM: $50/month\n- Storage: $50/month';
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: backendMarkdown,
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('Cost Analysis');
      expect(formatted).toContain('Estimated cost: $100/month');
      expect(formatted).toContain('VM: $50/month');
      expect(formatted).toContain('Storage: $50/month');
    });

    it('should include analysis markdown from local fallback', () => {
      const localMarkdown = '## Azure Resource Analysis\n\nDetected **3** resource(s) in your Bicep files:\n\n- **Virtual Machines**: 2\n- **Storage Accounts**: 1';
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: localMarkdown,
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('Azure Resource Analysis');
      expect(formatted).toContain('Detected **3** resource(s)');
      expect(formatted).toContain('Virtual Machines');
      expect(formatted).toContain('Storage Accounts');
    });

    it('should include footer with tool attribution', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '## Test',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('---');
      expect(formatted).toContain('🔍 Analyzed by');
      expect(formatted).toContain('ResourcePulse');
      expect(formatted).toContain('https://resourcepulseapp.com');
    });

    it('should include version in footer', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '## Test',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toMatch(/v\d+\.\d+\.\d+/);
      expect(formatted).toContain('v1.0.0');
    });

    it('should format complete comment with marker, content, and footer', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: '## Analysis Results\n\nAll looks good!',
      };

      const formatted = formatPRComment(result);

      // Should have all three parts
      const lines = formatted.split('\n');
      expect(lines[0]).toBe(COMMENT_MARKER);
      expect(formatted).toContain('## Analysis Results');
      expect(formatted).toContain('All looks good!');
      expect(formatted).toContain('---');
      expect(formatted.endsWith('</sub>')).toBe(true);
    });

    it('should preserve markdown formatting from backend', () => {
      const complexMarkdown = `## Security Review

### Critical Issues
- Issue 1
- Issue 2

### Recommendations
1. Use managed identities
2. Enable encryption

\`\`\`yaml
# Example config
encryption: enabled
\`\`\`

**Important**: Review these findings.`;

      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: complexMarkdown,
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('## Security Review');
      expect(formatted).toContain('### Critical Issues');
      expect(formatted).toContain('### Recommendations');
      expect(formatted).toContain('```yaml');
      expect(formatted).toContain('**Important**');
    });

    it('should handle empty markdown gracefully', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '',
      };

      const formatted = formatPRComment(result);

      // Should still have marker and footer
      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted).toContain('---');
      expect(formatted).toContain('ResourcePulse');
    });

    it('should handle markdown with special characters', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: '## Test\n\nCost: $100 < $200 & savings > 50%',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('$100 < $200 & savings > 50%');
    });

    it('should handle multiline markdown with various formatting', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: `# Title

## Section 1
Some text

## Section 2
- List item 1
- List item 2

> Blockquote

**Bold** and *italic* text.`,
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('# Title');
      expect(formatted).toContain('## Section 1');
      expect(formatted).toContain('> Blockquote');
      expect(formatted).toContain('**Bold**');
      expect(formatted).toContain('*italic*');
    });
  });

  describe('hasMarker', () => {
    it('should return true for comment with marker', () => {
      const comment = `${COMMENT_MARKER}\n## Test\nSome content`;

      expect(hasMarker(comment)).toBe(true);
    });

    it('should return true for marker anywhere in comment', () => {
      const comment = `Some text\n${COMMENT_MARKER}\nMore text`;

      expect(hasMarker(comment)).toBe(true);
    });

    it('should return false for comment without marker', () => {
      const comment = '## Regular Comment\nNo marker here';

      expect(hasMarker(comment)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasMarker('')).toBe(false);
    });

    it('should be case sensitive', () => {
      const comment = '<!-- AZURE-IAC-REVIEWER -->';

      expect(hasMarker(comment)).toBe(false);
    });

    it('should not match partial marker', () => {
      const comment = '<!-- azure-iac -->';

      expect(hasMarker(comment)).toBe(false);
    });
  });

  describe('extractContent', () => {
    it('should extract content between marker and footer', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '## Test Analysis\nThis is the content.',
      };

      const formatted = formatPRComment(result);
      const extracted = extractContent(formatted);

      expect(extracted).toContain('## Test Analysis');
      expect(extracted).toContain('This is the content.');
      expect(extracted).not.toContain(COMMENT_MARKER);
      expect(extracted).not.toContain('ResourcePulse');
    });

    it('should handle content without footer', () => {
      const comment = `${COMMENT_MARKER}\n## Test\nContent`;

      const extracted = extractContent(comment);

      expect(extracted).toContain('## Test');
      expect(extracted).toContain('Content');
      expect(extracted).not.toContain(COMMENT_MARKER);
    });

    it('should handle content with multiple horizontal rules', () => {
      const markdown = `## Analysis

---

Some content with a rule

---

More content`;

      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown,
      };

      const formatted = formatPRComment(result);
      const extracted = extractContent(formatted);

      // Should only remove the last --- (footer separator)
      expect(extracted).toContain('---');
      expect(extracted).toContain('Some content with a rule');
      expect(extracted).not.toContain('ResourcePulse');
    });

    it('should trim whitespace', () => {
      const comment = `${COMMENT_MARKER}

## Test

Content with spaces

---
Footer
`;

      const extracted = extractContent(comment);

      expect(extracted.startsWith('## Test')).toBe(true);
      expect(extracted.endsWith('Content with spaces')).toBe(true);
    });
  });

  describe('COMMENT_MARKER constant', () => {
    it('should be the correct HTML comment', () => {
      expect(COMMENT_MARKER).toBe('<!-- azure-iac-reviewer -->');
    });

    it('should be an HTML comment format', () => {
      expect(COMMENT_MARKER).toMatch(/^<!--.*-->$/);
    });
  });

  describe('integration scenarios', () => {
    it('should format backend success result correctly', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: `## Cost Analysis

### Estimated Monthly Cost: $150

**Breakdown:**
- Virtual Machine (Standard_D2s_v3): $70
- Storage Account (Premium LRS): $50
- App Service Plan (P1v2): $30

### Recommendations
- Consider reserved instances for 40% savings
- Enable auto-shutdown for dev environments`,
      };

      const formatted = formatPRComment(result);

      // Verify structure
      expect(formatted.startsWith(COMMENT_MARKER)).toBe(true);
      expect(formatted).toContain('## Cost Analysis');
      expect(formatted).toContain('Estimated Monthly Cost: $150');
      expect(formatted).toContain('Virtual Machine');
      expect(formatted).toContain('Recommendations');
      expect(formatted.endsWith('</sub>')).toBe(true);

      // Verify marker detection
      expect(hasMarker(formatted)).toBe(true);

      // Verify extraction works
      const extracted = extractContent(formatted);
      expect(extracted).toContain('## Cost Analysis');
      expect(extracted).not.toContain('ResourcePulse');
    });

    it('should format local fallback result correctly', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: `## Azure Resource Analysis

Detected **5** resource(s) in your Bicep files:

- **Virtual Machines**: 2
- **Storage Accounts**: 2
- **App Service Plans**: 1

---

💡 **Want detailed cost estimates and security recommendations?**

Add an API key to enable full analysis powered by ResourcePulse:

\`\`\`yaml
- uses: resourcepulse-io/azure-iac-reviewer@v1
  with:
    api_key: \${{ secrets.RESOURCEPULSE_API_KEY }}
\`\`\`

_This action analyzes anonymized resource metadata only - no source code or identifiers are transmitted._`,
      };

      const formatted = formatPRComment(result);

      // Verify complete structure
      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted).toContain('Azure Resource Analysis');
      expect(formatted).toContain('Detected **5** resource(s)');
      expect(formatted).toContain('Want detailed cost estimates');
      expect(formatted).toContain('api_key');
      expect(formatted).toContain('ResourcePulse');
      expect(formatted).toMatch(/v\d+\.\d+\.\d+/);
    });

    it('should be idempotent when formatting already formatted content', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: '## Analysis\nResults here',
      };

      const formatted1 = formatPRComment(result);

      // If we accidentally format twice (shouldn't happen, but test resilience)
      const result2: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: formatted1,
      };
      const formatted2 = formatPRComment(result2);

      // Should contain marker twice (once from original, once from double format)
      const markerCount = (formatted2.match(/<!-- azure-iac-reviewer -->/g) || []).length;
      expect(markerCount).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle very long content', () => {
      const longContent = '## Analysis\n\n' + 'x'.repeat(10000);
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: longContent,
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted.length).toBeGreaterThan(10000);
      expect(formatted).toContain('ResourcePulse');
    });

    it('should handle content with only whitespace', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'local',
        markdown: '   \n\n\n   ',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted).toContain('---');
    });

    it('should handle content with HTML comments', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: '## Analysis\n<!-- This is a comment -->\nContent',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain(COMMENT_MARKER);
      expect(formatted).toContain('<!-- This is a comment -->');
      expect(formatted).toContain('Content');
    });

    it('should handle content with code blocks containing marker-like text', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: `## Test

\`\`\`html
<!-- azure-iac-reviewer -->
This is in a code block
\`\`\``,
      };

      const formatted = formatPRComment(result);

      // Should have marker at the start AND in the code block
      const markerCount = (formatted.match(/<!-- azure-iac-reviewer -->/g) || []).length;
      expect(markerCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle markdown with Unicode characters', () => {
      const result: AnalysisResult = {
        success: true,
        source: 'backend',
        markdown: '## Análisis\n\nCostos: €100 • Región: São Paulo 🌎',
      };

      const formatted = formatPRComment(result);

      expect(formatted).toContain('Análisis');
      expect(formatted).toContain('€100');
      expect(formatted).toContain('São Paulo');
      expect(formatted).toContain('🌎');
    });
  });
});
