/**
 * Feature-gating keyword list (Phase 9 D-08) as data. Salesforce documents many standard fields that
 * only exist when an org has a feature switched on (Person Accounts, Data.com Clean, Territory
 * Management, ...). Both the PDF snapshot step and the generator run `matchGating` over the sources'
 * description prose in memory; the prose itself is never written anywhere, only the keyword ids are.
 */

export interface GatingKeyword {
  id: string;
  pattern: RegExp;
}

export const GATING_KEYWORDS: readonly GatingKeyword[] = [
  { id: "person-accounts", pattern: /\bperson accounts?\b/i },
  // "clean" alone is a common English word; only the product name counts.
  { id: "data-com", pattern: /\bdata\.com\b|\bjigsaw\b|\bdata\.com clean\b/i },
  { id: "territory-management", pattern: /\bterritory management\b|\benterprise territory\b/i },
  { id: "knowledge", pattern: /\bknowledge\b/i },
  { id: "omni-channel", pattern: /\bomni-channel\b/i },
  { id: "field-service", pattern: /\bfield service\b/i },
  { id: "social", pattern: /\bsocial customer service\b|\bsocial posts?\b/i },
  { id: "chatter", pattern: /\bchatter\b/i },
  { id: "enabled-phrase", pattern: /\bavailable (?:only )?(?:when|if) .{1,60}? (?:is|are) enabled\b/i },
  { id: "org-feature-phrase", pattern: /\bonly (?:available|visible) (?:in|to) organizations? (?:that have|with) /i },
];

/** Sorted, unique keyword ids whose pattern matches the prose. */
export function matchGating(prose: string): string[] {
  const hits = new Set<string>();
  for (const k of GATING_KEYWORDS) if (k.pattern.test(prose)) hits.add(k.id);
  return [...hits].sort();
}
