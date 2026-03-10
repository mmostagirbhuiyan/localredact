import { describe, it, expect } from 'vitest';
import { detectWithRegex } from '../regex-patterns';

describe('regex PII detection', () => {
  describe('SSN detection', () => {
    it('detects SSN with dashes', () => {
      const result = detectWithRegex('My SSN is 123-45-6789.');
      const ssns = result.filter((e) => e.category === 'SSN');
      expect(ssns).toHaveLength(1);
      expect(ssns[0].text).toBe('123-45-6789');
    });

    it('detects SSN with spaces', () => {
      const result = detectWithRegex('SSN: 123 45 6789');
      const ssns = result.filter((e) => e.category === 'SSN');
      expect(ssns).toHaveLength(1);
      expect(ssns[0].text).toBe('123 45 6789');
    });

    it('detects SSN without separators', () => {
      const result = detectWithRegex('SSN: 123456789');
      const ssns = result.filter((e) => e.category === 'SSN');
      expect(ssns).toHaveLength(1);
      expect(ssns[0].text).toBe('123456789');
    });

    it('detects multiple SSNs in same text', () => {
      const result = detectWithRegex('SSN1: 123-45-6789 and SSN2: 987-65-4321');
      const ssns = result.filter((e) => e.category === 'SSN');
      expect(ssns).toHaveLength(2);
    });
  });

  describe('credit card detection', () => {
    it('detects credit card with dashes', () => {
      const result = detectWithRegex('Card: 4111-1111-1111-1111');
      const cards = result.filter((e) => e.category === 'CREDIT_CARD');
      expect(cards).toHaveLength(1);
      expect(cards[0].text).toBe('4111-1111-1111-1111');
    });

    it('detects credit card with spaces', () => {
      const result = detectWithRegex('Card: 4111 1111 1111 1111');
      const cards = result.filter((e) => e.category === 'CREDIT_CARD');
      expect(cards).toHaveLength(1);
    });

    it('detects credit card without separators', () => {
      const result = detectWithRegex('Card: 4111111111111111');
      const cards = result.filter((e) => e.category === 'CREDIT_CARD');
      expect(cards).toHaveLength(1);
    });
  });

  describe('email detection', () => {
    it('detects standard email', () => {
      const result = detectWithRegex('Contact me at john.doe@example.com please.');
      const emails = result.filter((e) => e.category === 'EMAIL');
      expect(emails).toHaveLength(1);
      expect(emails[0].text).toBe('john.doe@example.com');
    });

    it('detects email with plus addressing', () => {
      const result = detectWithRegex('Email: user+tag@domain.org');
      const emails = result.filter((e) => e.category === 'EMAIL');
      expect(emails).toHaveLength(1);
      expect(emails[0].text).toBe('user+tag@domain.org');
    });

    it('detects multiple emails', () => {
      const result = detectWithRegex('From a@b.com to c@d.net');
      const emails = result.filter((e) => e.category === 'EMAIL');
      expect(emails).toHaveLength(2);
    });
  });

  describe('phone detection', () => {
    it('detects US phone with parentheses', () => {
      const result = detectWithRegex('Call (555) 123-4567');
      const phones = result.filter((e) => e.category === 'PHONE');
      expect(phones).toHaveLength(1);
      expect(phones[0].text).toContain('555');
      expect(phones[0].text).toContain('4567');
    });

    it('detects phone with dashes', () => {
      const result = detectWithRegex('Phone: 555-123-4567');
      const phones = result.filter((e) => e.category === 'PHONE');
      expect(phones).toHaveLength(1);
    });

    it('detects phone with +1 prefix', () => {
      const result = detectWithRegex('Call +1-555-123-4567');
      const phones = result.filter((e) => e.category === 'PHONE');
      expect(phones).toHaveLength(1);
      expect(phones[0].text).toContain('+1');
    });

    it('detects phone with dots', () => {
      const result = detectWithRegex('555.123.4567');
      const phones = result.filter((e) => e.category === 'PHONE');
      expect(phones).toHaveLength(1);
    });
  });

  describe('date detection', () => {
    it('detects MM/DD/YYYY', () => {
      const result = detectWithRegex('Born on 01/15/1990');
      const dates = result.filter((e) => e.category === 'DATE');
      expect(dates).toHaveLength(1);
      expect(dates[0].text).toBe('01/15/1990');
    });

    it('detects YYYY-MM-DD (ISO)', () => {
      const result = detectWithRegex('Date: 2024-03-15');
      const dates = result.filter((e) => e.category === 'DATE');
      expect(dates).toHaveLength(1);
      expect(dates[0].text).toBe('2024-03-15');
    });

    it('detects MM-DD-YYYY', () => {
      const result = detectWithRegex('DOB: 03-15-1990');
      const dates = result.filter((e) => e.category === 'DATE');
      expect(dates).toHaveLength(1);
    });
  });

  describe('position tracking', () => {
    it('reports correct start and end positions', () => {
      const text = 'Email: test@example.com here';
      const result = detectWithRegex(text);
      const email = result.find((e) => e.category === 'EMAIL');
      expect(email).toBeDefined();
      expect(text.slice(email!.start, email!.end)).toBe('test@example.com');
    });

    it('entities are sorted by position', () => {
      const result = detectWithRegex('SSN 123-45-6789 email a@b.com phone 555-123-4567');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start);
      }
    });
  });

  describe('overlap deduplication', () => {
    it('does not produce overlapping entities', () => {
      // A string that could match multiple patterns
      const result = detectWithRegex('Contact 123-456-7890 or email test@test.com');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
      }
    });
  });

  describe('source tagging', () => {
    it('all regex detections are tagged with source "regex"', () => {
      const result = detectWithRegex('SSN 123-45-6789 email a@b.com');
      for (const entity of result) {
        expect(entity.source).toBe('regex');
      }
    });
  });

  describe('clean text', () => {
    it('returns empty array for text with no PII', () => {
      const result = detectWithRegex('The quick brown fox jumps over the lazy dog.');
      expect(result).toHaveLength(0);
    });
  });

  describe('mixed PII document', () => {
    it('detects all PII types in a realistic document', () => {
      const doc = `
        Patient: John Smith
        SSN: 123-45-6789
        DOB: 01/15/1985
        Phone: (555) 867-5309
        Email: john.smith@hospital.org
        Credit Card: 4111-1111-1111-1111
      `;
      const result = detectWithRegex(doc);
      const categories = new Set(result.map((e) => e.category));

      expect(categories.has('SSN')).toBe(true);
      expect(categories.has('DATE')).toBe(true);
      expect(categories.has('PHONE')).toBe(true);
      expect(categories.has('EMAIL')).toBe(true);
      expect(categories.has('CREDIT_CARD')).toBe(true);
    });
  });
});
