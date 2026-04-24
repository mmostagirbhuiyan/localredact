import { describe, expect, it } from 'vitest';
import { DetectedEntity } from '../entity-types';
import { findKeywordEntities, parseKeywordList } from '../keyword-matcher';

describe('keyword matcher', () => {
  describe('parseKeywordList', () => {
    it('parses newline, comma, and semicolon separated keywords', () => {
      expect(parseKeywordList('Project Atlas\nAcme, Beta; Delta')).toEqual([
        'Project Atlas',
        'Acme',
        'Beta',
        'Delta',
      ]);
    });

    it('deduplicates keywords case-insensitively', () => {
      expect(parseKeywordList('Atlas\natlas\nATLAS')).toEqual(['Atlas']);
    });
  });

  describe('findKeywordEntities', () => {
    it('finds case-insensitive matches by default', () => {
      const result = findKeywordEntities('Project Atlas and project atlas', 'project atlas');

      expect(result.entities).toHaveLength(2);
      expect(result.entities.map((e) => e.text)).toEqual(['Project Atlas', 'project atlas']);
      expect(result.entities.every((e) => e.category === 'CUSTOM')).toBe(true);
      expect(result.entities.every((e) => e.source === 'keyword')).toBe(true);
    });

    it('supports case-sensitive matching', () => {
      const result = findKeywordEntities('Atlas atlas ATLAS', 'Atlas', [], { caseSensitive: true });

      expect(result.entities.map((e) => e.text)).toEqual(['Atlas']);
    });

    it('uses whole-word matching by default', () => {
      const result = findKeywordEntities('cat catalog cat', 'cat');

      expect(result.entities.map((e) => e.start)).toEqual([0, 12]);
    });

    it('can disable whole-word matching', () => {
      const result = findKeywordEntities('cat catalog', 'cat', [], { wholeWord: false });

      expect(result.entities.map((e) => e.text)).toEqual(['cat', 'cat']);
    });

    it('matches phrases across flexible whitespace', () => {
      const result = findKeywordEntities('Project\nAtlas and Project   Atlas', 'Project Atlas');

      expect(result.entities.map((e) => e.text)).toEqual(['Project\nAtlas', 'Project   Atlas']);
    });

    it('skips matches that overlap existing entities', () => {
      const existing: DetectedEntity[] = [{
        id: 'existing',
        text: 'Project Atlas',
        category: 'ORGANIZATION',
        source: 'ner',
        start: 0,
        end: 13,
        accepted: true,
      }];

      const result = findKeywordEntities('Project Atlas Project Atlas', 'Project Atlas', existing);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].start).toBe(14);
      expect(result.summary.skippedOverlapCount).toBe(1);
    });

    it('prefers longer overlapping keywords within the submitted list', () => {
      const result = findKeywordEntities('Project Atlas', 'Atlas\nProject Atlas');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].text).toBe('Project Atlas');
    });
  });
});
