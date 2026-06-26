// @agentkitai/agentgate-core - Shared utility functions

/**
 * Truncate a string to a max length, adding ellipsis if truncated
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen < 4) return str.slice(0, maxLen);
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Options for formatJson
 */
export interface FormatJsonOptions {
  /** Maximum length of the output string (default: 500) */
  maxLen?: number;
  /** Whether to escape HTML in the output (default: false) */
  escapeHtml?: boolean;
}

/**
 * Format a JSON object for display, with optional truncation and HTML escaping
 */
export function formatJson(
  obj: Record<string, unknown>,
  maxLenOrOptions?: number | FormatJsonOptions
): string {
  const options: FormatJsonOptions =
    typeof maxLenOrOptions === 'number'
      ? { maxLen: maxLenOrOptions }
      : maxLenOrOptions ?? {};

  const maxLen = options.maxLen ?? 500;
  const str = JSON.stringify(obj, null, 2);
  const truncated = str.length <= maxLen ? str : str.slice(0, maxLen - 3) + '...';
  return options.escapeHtml ? escapeHtml(truncated) : truncated;
}

/**
 * Get urgency emoji
 */
export function getUrgencyEmoji(urgency: string): string {
  switch (urgency) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'normal': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}
