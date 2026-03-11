import { describe, it, expect } from 'vitest';
import { verifyNoPIIInBytes } from '../pdf-redactor';

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

describe('verifyNoPIIInBytes', () => {
  it('returns empty array when no PII found', () => {
    const bytes = toBytes('This is a clean PDF with no personal data');
    const result = verifyNoPIIInBytes(bytes, ['John Smith', '123-45-6789']);
    expect(result).toEqual([]);
  });

  it('detects exact PII string in bytes', () => {
    const bytes = toBytes('Some PDF content John Smith more content');
    const result = verifyNoPIIInBytes(bytes, ['John Smith']);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('John Smith');
  });

  it('detects case-insensitive matches', () => {
    const bytes = toBytes('metadata author: john smith');
    const result = verifyNoPIIInBytes(bytes, ['John Smith']);
    expect(result).toHaveLength(1);
  });

  it('detects multiple PII strings', () => {
    const bytes = toBytes('John Smith lives at 123 Main St');
    const result = verifyNoPIIInBytes(bytes, ['John Smith', '123 Main St']);
    expect(result).toHaveLength(2);
  });

  it('skips strings shorter than 4 characters (handled by caller)', () => {
    // The caller filters to >= 4 chars, but verify the function itself works
    const bytes = toBytes('Mr. John');
    const result = verifyNoPIIInBytes(bytes, ['Mr.']);
    // Still finds it since the function doesn't filter — caller does
    expect(result).toHaveLength(1);
  });

  it('deduplicates PII strings', () => {
    const bytes = toBytes('John Smith appears twice John Smith');
    const result = verifyNoPIIInBytes(bytes, ['John Smith', 'John Smith', 'john smith']);
    // Should only report once despite duplicates in input
    expect(result).toHaveLength(1);
  });

  it('detects UTF-16BE encoded strings', () => {
    // Simulate UTF-16BE: each char preceded by 0x00
    const pii = 'John';
    const utf16be = new Uint8Array(pii.length * 2);
    for (let i = 0; i < pii.length; i++) {
      utf16be[i * 2] = 0;
      utf16be[i * 2 + 1] = pii.charCodeAt(i);
    }
    // Wrap in some PDF-like bytes
    const prefix = toBytes('some pdf data ');
    const suffix = toBytes(' end');
    const combined = new Uint8Array(prefix.length + utf16be.length + suffix.length);
    combined.set(prefix);
    combined.set(utf16be, prefix.length);
    combined.set(suffix, prefix.length + utf16be.length);

    const result = verifyNoPIIInBytes(combined, ['John']);
    expect(result).toHaveLength(1);
  });

  it('returns byte offset of leak', () => {
    const bytes = toBytes('AAAA123-45-6789BBBB');
    const result = verifyNoPIIInBytes(bytes, ['123-45-6789']);
    expect(result).toHaveLength(1);
    expect(result[0].byteOffset).toBe(4);
  });

  it('handles empty PII list', () => {
    const bytes = toBytes('any content');
    const result = verifyNoPIIInBytes(bytes, []);
    expect(result).toEqual([]);
  });

  it('handles empty bytes', () => {
    const result = verifyNoPIIInBytes(new Uint8Array(0), ['John Smith']);
    expect(result).toEqual([]);
  });
});
