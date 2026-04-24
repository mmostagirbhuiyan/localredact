import { createEntityId, DetectedEntity } from './entity-types';

export interface KeywordMatchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface KeywordMatchSummary {
  keywordCount: number;
  matchCount: number;
  skippedOverlapCount: number;
}

export interface KeywordMatchResult {
  entities: DetectedEntity[];
  summary: KeywordMatchSummary;
}

const WORD_CHAR_RE = /[A-Za-z0-9_]/;

export function parseKeywordList(input: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const raw of input.split(/[\n,;]+/)) {
    const keyword = raw.trim();
    if (!keyword) continue;

    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    keywords.push(keyword);
  }

  return keywords;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleKeywordPattern(keyword: string): string {
  return keyword
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
}

function isWordChar(value: string | undefined): boolean {
  return value !== undefined && WORD_CHAR_RE.test(value);
}

function hasWholeWordBoundary(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

function overlapsAny(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

export function findKeywordEntities(
  text: string,
  keywordInput: string,
  existingEntities: DetectedEntity[] = [],
  options: KeywordMatchOptions = {},
): KeywordMatchResult {
  const keywords = parseKeywordList(keywordInput)
    .sort((a, b) => b.length - a.length);

  const entities: DetectedEntity[] = [];
  const occupiedRanges = existingEntities.map((entity) => ({
    start: entity.start,
    end: entity.end,
  }));
  let skippedOverlapCount = 0;

  for (const keyword of keywords) {
    const pattern = buildFlexibleKeywordPattern(keyword);
    const flags = options.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (options.wholeWord !== false && !hasWholeWordBoundary(text, start, end)) {
        continue;
      }

      if (overlapsAny(start, end, occupiedRanges)) {
        skippedOverlapCount++;
        continue;
      }

      occupiedRanges.push({ start, end });
      entities.push({
        id: createEntityId(),
        text: match[0],
        category: 'CUSTOM',
        source: 'keyword',
        start,
        end,
        accepted: true,
        confidence: 1.0,
      });
    }
  }

  entities.sort((a, b) => a.start - b.start);

  return {
    entities,
    summary: {
      keywordCount: keywords.length,
      matchCount: entities.length,
      skippedOverlapCount,
    },
  };
}
