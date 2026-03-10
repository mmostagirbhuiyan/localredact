import { describe, it, expect } from 'vitest';
import { ENTITY_CONFIG, createEntityId, EntityCategory } from '../entity-types';

describe('entity types', () => {
  describe('ENTITY_CONFIG', () => {
    const expectedCategories: EntityCategory[] = [
      'PERSON', 'ORGANIZATION', 'LOCATION', 'SSN', 'CREDIT_CARD', 'EMAIL', 'PHONE', 'DATE',
    ];

    it('has config for all entity categories', () => {
      for (const cat of expectedCategories) {
        expect(ENTITY_CONFIG[cat]).toBeDefined();
      }
    });

    it('every config has label, colorVar, and softVar', () => {
      for (const cat of expectedCategories) {
        const config = ENTITY_CONFIG[cat];
        expect(config.label).toBeTruthy();
        expect(config.colorVar).toMatch(/^--pii-/);
        expect(config.softVar).toMatch(/^--pii-/);
      }
    });

    it('SSN and CREDIT_CARD share the same color', () => {
      expect(ENTITY_CONFIG.SSN.colorVar).toBe(ENTITY_CONFIG.CREDIT_CARD.colorVar);
    });

    it('EMAIL and PHONE share the same color', () => {
      expect(ENTITY_CONFIG.EMAIL.colorVar).toBe(ENTITY_CONFIG.PHONE.colorVar);
    });
  });

  describe('createEntityId', () => {
    it('returns unique IDs on successive calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(createEntityId());
      }
      expect(ids.size).toBe(100);
    });

    it('returns strings starting with "entity-"', () => {
      const id = createEntityId();
      expect(id).toMatch(/^entity-\d+$/);
    });
  });
});
