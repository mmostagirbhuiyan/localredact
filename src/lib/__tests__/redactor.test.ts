import { describe, it, expect } from 'vitest';
import { redactText } from '../redactor';
import { DetectedEntity } from '../entity-types';

function makeEntity(overrides: Partial<DetectedEntity> & { start: number; end: number; text: string }): DetectedEntity {
  return {
    id: `test-${overrides.start}`,
    category: 'EMAIL',
    source: 'regex',
    accepted: true,
    ...overrides,
  };
}

describe('redactor', () => {
  describe('text style redaction', () => {
    it('replaces a single entity with [REDACTED]', () => {
      const text = 'Email me at test@example.com please';
      const entities = [makeEntity({ text: 'test@example.com', start: 12, end: 28 })];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('Email me at [REDACTED] please');
    });

    it('replaces multiple entities', () => {
      const text = 'Call 555-1234 or email a@b.com';
      const entities = [
        makeEntity({ text: '555-1234', start: 5, end: 13, category: 'PHONE' }),
        makeEntity({ text: 'a@b.com', start: 23, end: 30, category: 'EMAIL' }),
      ];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('Call [REDACTED] or email [REDACTED]');
    });

    it('handles entities at the start of text', () => {
      const text = 'test@example.com is my email';
      const entities = [makeEntity({ text: 'test@example.com', start: 0, end: 16 })];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('[REDACTED] is my email');
    });

    it('handles entities at the end of text', () => {
      const text = 'My email is test@example.com';
      const entities = [makeEntity({ text: 'test@example.com', start: 12, end: 28 })];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('My email is [REDACTED]');
    });
  });

  describe('block style redaction', () => {
    it('replaces with black blocks matching original length', () => {
      const text = 'SSN: 123-45-6789';
      const entities = [makeEntity({ text: '123-45-6789', start: 5, end: 16, category: 'SSN' })];
      const result = redactText(text, entities, 'blocks');
      expect(result).toBe('SSN: \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588');
      // Block count should match original text length
      expect(result.length).toBe(text.length);
    });
  });

  describe('accepted/rejected filtering', () => {
    it('only redacts accepted entities', () => {
      const text = 'Email a@b.com and c@d.com';
      const entities = [
        makeEntity({ text: 'a@b.com', start: 6, end: 13, accepted: true }),
        makeEntity({ text: 'c@d.com', start: 18, end: 25, accepted: false }),
      ];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('Email [REDACTED] and c@d.com');
    });

    it('returns original text when all entities are rejected', () => {
      const text = 'Email a@b.com';
      const entities = [
        makeEntity({ text: 'a@b.com', start: 6, end: 13, accepted: false }),
      ];
      const result = redactText(text, entities, 'text');
      expect(result).toBe(text);
    });
  });

  describe('empty inputs', () => {
    it('returns original text with empty entity list', () => {
      const text = 'Nothing to redact here';
      const result = redactText(text, [], 'text');
      expect(result).toBe(text);
    });

    it('handles empty string', () => {
      const result = redactText('', [], 'text');
      expect(result).toBe('');
    });
  });

  describe('index integrity', () => {
    it('preserves surrounding text when redacting multiple entities', () => {
      const text = 'A 123-45-6789 B 987-65-4321 C';
      const entities = [
        makeEntity({ text: '123-45-6789', start: 2, end: 13, category: 'SSN' }),
        makeEntity({ text: '987-65-4321', start: 16, end: 27, category: 'SSN' }),
      ];
      const result = redactText(text, entities, 'text');
      expect(result).toBe('A [REDACTED] B [REDACTED] C');
    });
  });

  describe('default style', () => {
    it('defaults to text style', () => {
      const text = 'SSN: 123-45-6789';
      const entities = [makeEntity({ text: '123-45-6789', start: 5, end: 16, category: 'SSN' })];
      const result = redactText(text, entities);
      expect(result).toBe('SSN: [REDACTED]');
    });
  });
});
