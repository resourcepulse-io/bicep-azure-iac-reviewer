import { AnalysisResult } from '../backend/client';

/**
 * Comment marker for identifying comments created by this action
 */
export const COMMENT_MARKER = '<!-- azure-iac-reviewer -->';

/**
 * Get the version of this action from package.json
 * @returns Version string (e.g., "1.0.0")
 */
function getVersion(): string {
  // In production, this would be injected during build
  // For now, return a static version
  return '1.0.0';
}

/**
 * Generate footer with tool attribution
 * @returns Footer markdown
 */
function generateFooter(): string {
  const version = getVersion();
  return `\n---\n<sub>🔍 Analyzed by [ResourcePulse](https://resourcepulse.io) • v${version}</sub>`;
}

/**
 * Format an error banner for display in PR comments
 * @param result - Analysis result with error details
 * @returns Markdown error banner or empty string
 */
function formatErrorBanner(result: AnalysisResult): string {
  if (!result.error || result.success) {
    return '';
  }

  const lines: string[] = [];
  lines.push('> [!WARNING]');
  lines.push(`> **Backend analysis failed:** ${result.error}`);
  lines.push('>');
  lines.push('> Showing local summary instead. Check your action configuration if this persists.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format analysis result as PR comment markdown
 * Adds comment marker and footer to the analysis markdown
 * @param result - Analysis result from backend or local fallback
 * @returns Complete PR comment body with marker and footer
 */
export function formatPRComment(result: AnalysisResult): string {
  const lines: string[] = [];

  // Add marker comment for update-in-place functionality
  lines.push(COMMENT_MARKER);

  // Add error banner if backend failed
  const errorBanner = formatErrorBanner(result);
  if (errorBanner) {
    lines.push(errorBanner);
  }

  // Add the analysis content (already formatted as markdown)
  lines.push(result.markdown);

  // Add footer with attribution
  lines.push(generateFooter());

  return lines.join('\n');
}

/**
 * Check if a comment body was created by this action
 * @param commentBody - Comment body to check
 * @returns True if the comment contains the marker
 */
export function hasMarker(commentBody: string): boolean {
  return commentBody.includes(COMMENT_MARKER);
}

/**
 * Extract the content from a marked comment (removes marker and footer)
 * Useful for testing or comment analysis
 * @param markedComment - Comment with marker and footer
 * @returns Just the analysis content
 */
export function extractContent(markedComment: string): string {
  // Remove marker
  let content = markedComment.replace(COMMENT_MARKER, '').trim();

  // Remove footer (everything after the last ---)
  const footerIndex = content.lastIndexOf('\n---\n');
  if (footerIndex !== -1) {
    content = content.substring(0, footerIndex).trim();
  }

  return content;
}
