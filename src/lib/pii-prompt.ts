export const PII_SYSTEM_PROMPT = `You extract sensitive information from documents. Return a JSON array.

Each item: {"type":"TYPE","text":"exact text from input"}

Types to extract:
PERSON - any human name (full, first, or last)
ORGANIZATION - any company, agency, institution, or named entity
LOCATION - any city, state, country, or region
ADDRESS - any street address or postal code
DATE - any date (written or numeric)

Critical rules:
- The "text" value MUST be copied exactly from the input
- Do NOT invent or hallucinate entities not present in the input
- Extract ALL instances, not just the first
- Output raw JSON only, no markdown fences`;

export function buildPIIUserPrompt(text: string): string {
  return `Extract every person name, organization, location, address, and date from this text:\n\n${text}`;
}
