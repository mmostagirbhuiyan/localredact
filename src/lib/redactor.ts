import { DetectedEntity } from './entity-types';

export type RedactStyle = 'text' | 'blocks';

export function redactText(
  originalText: string,
  entities: DetectedEntity[],
  style: RedactStyle = 'text',
): string {
  // Only redact accepted entities
  const accepted = entities
    .filter((e) => e.accepted)
    .sort((a, b) => b.start - a.start); // Reverse order to preserve indices

  let result = originalText;

  for (const entity of accepted) {
    const replacement =
      style === 'blocks'
        ? '\u2588'.repeat(entity.text.length)
        : '[REDACTED]';
    result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
  }

  return result;
}
