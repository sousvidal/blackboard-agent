/**
 * Token counting utilities for managing blackboard size
 * Using a simple approximation: 1 token ≈ 4 characters
 * This is rough but good enough for limiting blackboard size
 */

export function estimateTokens(text: string): number {
  // Remove extra whitespace for more accurate counting
  const cleaned = text.trim();
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(cleaned.length / 4);
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) {
    return text;
  }

  // Calculate how many characters we can keep
  const maxChars = maxTokens * 4;
  const truncated = text.slice(0, maxChars);

  return truncated + '\n\n[... truncated to fit token limit]';
}

export function formatTokenCount(current: number, max: number): string {
  const percentage = Math.round((current / max) * 100);
  return `${current} / ${max} tokens (${percentage}%)`;
}
