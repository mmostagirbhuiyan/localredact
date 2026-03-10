import { EntityCategory, DetectedEntity, createEntityId } from './entity-types';

interface PatternDef {
  pattern: RegExp;
  category: EntityCategory;
}

const PATTERNS: PatternDef[] = [
  // SSN: 123-45-6789 or 123 45 6789
  {
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    category: 'SSN',
  },
  // Credit card: 16 digits with optional dashes/spaces
  {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    category: 'CREDIT_CARD',
  },
  // Email
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    category: 'EMAIL',
  },
  // Phone: various US formats
  {
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    category: 'PHONE',
  },
  // Date: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
  {
    pattern: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/g,
    category: 'DATE',
  },
];

export function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  for (const { pattern, category } of PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    // Use RegExp.prototype.exec to find all matches
    match = pattern.exec(text);
    while (match !== null) {
      entities.push({
        id: createEntityId(),
        text: match[0],
        category,
        source: 'regex',
        start: match.index,
        end: match.index + match[0].length,
        accepted: true,
      });
      match = pattern.exec(text);
    }
  }

  // Sort by position, deduplicate overlaps (keep first match)
  entities.sort((a, b) => a.start - b.start);
  return deduplicateOverlaps(entities);
}

function deduplicateOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  const result: DetectedEntity[] = [];
  let lastEnd = -1;

  for (const entity of entities) {
    if (entity.start >= lastEnd) {
      result.push(entity);
      lastEnd = entity.end;
    }
  }

  return result;
}
