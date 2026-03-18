export type EntityCategory =
  | 'PERSON'
  | 'ORGANIZATION'
  | 'LOCATION'
  | 'ADDRESS'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'DATE';

export type DetectionSource = 'regex' | 'ner';

export interface DetectedEntity {
  id: string;
  text: string;
  category: EntityCategory;
  source: DetectionSource;
  start: number;
  end: number;
  accepted: boolean;
  confidence?: number; // 0-1, regex=1.0, LLM=model-reported
}

export const ENTITY_CONFIG: Record<EntityCategory, { label: string; colorVar: string; softVar: string }> = {
  PERSON:       { label: 'Person',      colorVar: '--pii-person',      softVar: '--pii-person-soft' },
  ORGANIZATION: { label: 'Organization', colorVar: '--pii-org',         softVar: '--pii-org-soft' },
  LOCATION:     { label: 'Location',    colorVar: '--pii-location',    softVar: '--pii-location-soft' },
  ADDRESS:      { label: 'Address',    colorVar: '--pii-address',     softVar: '--pii-address-soft' },
  SSN:          { label: 'SSN',         colorVar: '--pii-ssn-cc',      softVar: '--pii-ssn-cc-soft' },
  CREDIT_CARD:  { label: 'Credit Card', colorVar: '--pii-ssn-cc',      softVar: '--pii-ssn-cc-soft' },
  EMAIL:        { label: 'Email',       colorVar: '--pii-email-phone', softVar: '--pii-email-phone-soft' },
  PHONE:        { label: 'Phone',       colorVar: '--pii-email-phone', softVar: '--pii-email-phone-soft' },
  DATE:         { label: 'Date',        colorVar: '--pii-date',        softVar: '--pii-date-soft' },
};

let entityCounter = 0;

export function createEntityId(): string {
  return `entity-${++entityCounter}`;
}
