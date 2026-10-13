---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 03
subsystem: baseline-generator
tags: [object-reference, pdftotext, snapshot, gating, facts-only]
requires: [09-01]
provides:
  - "scripts/gen-baseline/gating.ts: GATING_KEYWORDS (D-08) + matchGating(prose) -> keyword ids"
  - "scripts/gen-baseline/snapshot-pdf.ts: manual download/pin/pdftotext/parse/write step (pnpm baseline:snapshot [-- --pdf <path>])"
  - "scripts/gen-baseline/snapshot-lists.ts: KNOWN_PROPERTY_TOKENS, KNOWN_GAPS, DOC_ONLY_REVIEWED, NOT_IN_PDF"
  - "scripts/gen-baseline/source/object-reference/<Object>.json x35 + VENDOR.md (facts only, PDF pinned by sha256)"
  - "packages/metadata/test/object-reference-snapshot.test.ts: committed-extraction sanity"
affects: [09-04, 09-05, 09-06]
tech-stack:
  added: []
  patterns: ["facts-only extraction of a copyrighted PDF: prose read in memory, only tokens/numbers/keyword ids written", "TOC-order + printed-page-number section slicing for pdftotext -layout output"]
key-files:
  created:
    - scripts/gen-baseline/gating.ts
    - scripts/gen-baseline/snapshot-lists.ts
    - scripts/gen-baseline/snapshot-pdf.ts
    - scripts/gen-baseline/source/object-reference/ (35 JSON + VENDOR.md)
    - packages/metadata/test/object-reference-snapshot.test.ts
  modified:
    - .github/workflows/ci.yml
key-decisions:
  - "BusinessProcess is in the PDF (heading 'Business Process', TOC p. 1034): extracted; NOT_IN_PDF is empty and research's 'absent from both sources' is corrected"
  - "Labels in the field tables are recognised by text (Type/Properties/Description/Relationship Name/Relationship Type/Refers To), not by column position, because bulleted field groups shift the details column within a table"
  - "'Limit: N characters' is read as maxLength alongside 'Maximum size is N characters' (BusinessProcess uses the former)"
  - "A Properties token made of known tokens without a comma ('Sort Update') is split with a warning instead of failing the run"
metrics:
  duration: 31min
  completed: 2026-10-13
requirements-completed: []
---

# Phase 9 Plan 03: Object Reference facts extraction and gating list Summary

Facts-only extraction of the public Object Reference PDF (pinned sha256 `6b9d3731…`, Last-Modified 2026-10-09) for all 35 baseline objects, 1 472 fields with type/property tokens, `maxLength`, Refers To, relationship names/types and D-08 gating ids, cross-checked field-by-field against the sf-skills snapshot with one reasoned gap and seven reviewed doc-only fields.

## Commits
- 0bcc7f8 feat: gating.ts, snapshot-lists.ts, snapshot-pdf.ts, unconditional `pnpm typecheck:scripts` in CI
- c8749fa test: object-reference-snapshot.test.ts (RED before the extraction existed: 2 failed / 3 vacuously passed)
- c8a9b67 feat: source/object-reference/*.json (35) + VENDOR.md (GREEN: 5/5)

## Pin (VENDOR.md)
| Key | Value |
|---|---|
| URL | https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf |
| Last-Modified | Fri, 09 Oct 2026 22:12:36 GMT |
| Size | 21277574 |
| sha256 | 6b9d37316f0985d8047c32507e6e6fc20693b6e2c6865d067228c966fd8dbef5 |
| Extractor | snapshot-pdf.ts with pdftotext 26.04.0 -layout (6438 pages, 1781 TOC entries) |
| Not in PDF | none |
| Local cache for re-runs | `~/.cache/orglet/object_reference-6b9d37316f09.pdf` (pass as `--pdf`; no network) |

Same sha256 as the research download of 2026-10-13. The PDF and the raw text live only under the scratch dir (`mkdtempSync(join(tmpdir(), "orglet-objref-"))`, run with `TMPDIR` pointing at the session scratchpad) plus the cache copy outside the repo. `git ls-files` contains no `.pdf` / `object_reference.txt`.

## Per-object table (final run)
Columns: sf-skills `fields` (non-custom), extracted, missing (of which gap-listed), docOnly (gated / reviewed), master-detail.

| object | sf-skills | extracted | missing(gap) | docOnly(gated/reviewed) | master-detail |
|---|---|---|---|---|---|
| Account | 76 | 117 | 0(0) | 2(2/0) | 0 |
| Asset | 67 | 67 | 0(0) | 0(0/0) | 0 |
| BusinessHours | 20 | 20 | 0(0) | 0(0/0) | 0 |
| BusinessProcess | 0 | 5 | 0(0) | 5(0/5) | 0 |
| CallCenter | 6 | 6 | 0(0) | 0(0/0) | 0 |
| Campaign | 69 | 69 | 0(0) | 0(0/0) | 0 |
| CampaignMember | 32 | 32 | 0(0) | 0(0/0) | 0 |
| Case | 50 | 50 | 0(0) | 0(0/0) | 0 |
| Contact | 84 | 84 | 0(0) | 0(0/0) | 0 |
| Contract | 57 | 57 | 0(0) | 0(0/0) | 0 |
| DandBCompany | 108 | 108 | 0(0) | 0(0/0) | 0 |
| Entitlement | 22 | 22 | 0(0) | 0(0/0) | 0 |
| Event | 53 | 53 | 0(0) | 0(0/0) | 0 |
| ExternalDataSource | 13 | 13 | 0(0) | 0(0/0) | 0 |
| Group | 11 | 11 | 0(0) | 0(0/0) | 0 |
| IdeaTheme | 9 | 9 | 0(0) | 0(0/0) | 0 |
| Individual | 28 | 28 | 0(0) | 0(0/0) | 0 |
| Lead | 74 | 74 | 0(0) | 0(0/0) | 0 |
| OperatingHours | 6 | 6 | 0(0) | 0(0/0) | 0 |
| Opportunity | 54 | 54 | 0(0) | 0(0/0) | 0 |
| OpportunityHistory | 10 | 10 | 0(0) | 0(0/0) | 0 |
| OpportunityLineItem | 26 | 26 | 0(0) | 0(0/0) | 0 |
| Organization | 90 | 91 | 0(0) | 1(0/1) | 0 |
| Pricebook2 | 10 | 10 | 0(0) | 0(0/0) | 0 |
| PricebookEntry | 11 | 11 | 0(0) | 0(0/0) | 0 |
| Product2 | 36 | 37 | 0(0) | 0(0/0) | 0 |
| Profile | 8 | 8 | 1(1) | 1(0/1) | 0 |
| RecordType | 8 | 8 | 0(0) | 0(0/0) | 0 |
| ServiceAppointment | 44 | 44 | 0(0) | 0(0/0) | 0 |
| ServiceContract | 46 | 46 | 0(0) | 0(0/0) | 0 |
| SocialPost | 59 | 59 | 0(0) | 0(0/0) | 0 |
| Task | 39 | 39 | 0(0) | 0(0/0) | 0 |
| User | 175 | 175 | 0(0) | 0(0/0) | 0 |
| UserLicense | 9 | 9 | 0(0) | 0(0/0) | 0 |
| UserRole | 14 | 14 | 0(0) | 0(0/0) | 0 |

Totals: 1 472 fields, 144 with `maxLength`, 205 `reference` fields of which 103 carry a Relationship Type line (all `lookup`), 0 master-detail on the 35 (as research expected). Account's 117 = 76 `fields` + 39 from `ispersonaccount_fields`/`field_reference` + 2 doc-only gated (`PersonMailingStateCode`, `PersonOtherStateCode`, both `person-accounts`).

## KNOWN_GAPS / DOC_ONLY_REVIEWED (every entry)
| List | Object.Field | Reason |
|---|---|---|
| KNOWN_GAPS | Profile.Permissions | placeholder for the per-permission boolean family (Permissions<Name>), not a field; the PDF prints it as PermissionsPermissionName |
| DOC_ONLY_REVIEWED | BusinessProcess.{Description, IsActive, Name, NamespacePrefix, TableEnumOrId} | no sf-skills file for BusinessProcess (missing upstream); the PDF section "Business Process" is the only source |
| DOC_ONLY_REVIEWED | Organization.PreferencesPublicSectorTaxRevEnabled | org preference boolean documented in the PDF but newer than the sf-skills pin; no feature keyword in its prose |
| DOC_ONLY_REVIEWED | Profile.PermissionsPermissionName | placeholder name for the per-permission boolean family, not a field; the generator must skip it |
| NOT_IN_PDF | (empty) | every objects.json name has a section |

Budget: 1 gap entry (limit was ~30).

## KNOWN_PROPERTY_TOKENS (as printed; all 20 observed in the PDF, counts over 1 472 fields)
Aggregate 5, Autonumber 4, Create 937, Defaulted on create 198, Defaulted on create or filter 1, Delete 2, Filter 1427, Group 971, Layout 1, Namefield 1, Nillable 1069, Query 4, Restricted picklist 151, Retrieve 3, Search 1, Sort 1183, Undelete 1, Update 964, aggregate 1, idLookup 27.

Type tokens seen (lower-cased): string 319, boolean 241, picklist 233, reference 205, int 98, datetime 85, double 56, textarea 50, date 42, currency 36, phone 29, url 17, address 16, time 14, email 12, percent 9, junctionidlist 5, multipicklist 2, combobox 2, id 1. Note `combobox` and `id` for the 09-04 type map.

## Gating hits (keyword ids only; 09-04 lists them for review per D-08)
person-accounts 55, social 48, enabled-phrase 39, chatter 22, data-com 14, field-service 7, knowledge 2, territory-management 1. Per object: Account 56, SocialPost 47, User 23, Asset 14, Lead 10, Product2 6, Case 5, Contact 5, Entitlement 4, Event 3, Group 3, Opportunity 2, ServiceAppointment 2, Task 2, UserLicense 2, CampaignMember/PricebookEntry/Profile/RecordType 1.

Likely false positives for the generator's override list (prose mentions the feature without being gated by it): `Account.Name`, `Lead.Company`, `Lead.Title` (person-accounts), `Contact.IndividualId`, `User.IndividualId` (enabled-phrase), `Case.SourceId` (social), `User.UserType` (chatter). Contact/Lead Data.com fields (`CleanStatus`, `Jigsaw`, `JigsawContactId`, `CompanyDunsNumber`, `DandBCompanyId`) are present in sf-skills `fields` at this pin and carry `data-com`; the "~46/~51 doc-only Data.com fields" research expected came from its crude parser and do not exist.

## OwnerId Refers To as extracted (D-11 cross-check for 09-05)
User only: Account, Asset, Campaign, Contact, Contract, Individual, Opportunity. Group+User: Case, Lead, OperatingHours, ServiceAppointment, SocialPost, Task. Event: Calendar, User (D-12). Group: Organization, User (Open Question 2). ServiceContract: OwnerId present, no Refers To line (Open Question 1 stands). Solution/Location/ContactRequest/WorkOrder are not in the 35.

## Parser notes (Research Pitfall 7, resolved)
- Sections: TOC entries (`<name> . . . <printed page>`) mapped to page chunks via the printed footer number; section = heading line (indent <= 8, exact text) to the next TOC entry's heading. "Business Process" is matched by removing spaces.
- Table headers: `Field Name  Details`, `Field  Details` and `Field  Field Type` (Opportunity, Task) all occur; `Field Name  Description` tables are skipped.
- Field start: name-column token + `Type`; long names push `Type` onto the same line (`CommerceCustomerReference Type`); `Address (beta)` style qualifiers are stripped; bulleted groups (`• PersonMailingCity … • PersonMailingState`) share one details block and are written as separate fields with identical facts.
- Multi-line Properties/Refers To are joined; parenthetical remarks in Refers To are dropped; `• Refers To: X` bullet forms are handled (none occur in the 35).
- Run warnings (4, kept as warnings): `Account.PersonReportsToId` Properties "Sort Update" split on the missing comma; Relationship Name printed as a label and dropped on `Campaign.LastModifiedById` ("Last Modified"), `Campaign.TenantId` ("Business Unit"), `CampaignMember.AccountId` ("Related Record ID").
- Determinism: two runs (local `--pdf` and download) produced byte-identical JSON; only VENDOR.md's Last-Modified differed.

## Deviations from Plan
1. **[Finding corrected] BusinessProcess is in the PDF.** The plan and research expected `NOT_IN_PDF = { BusinessProcess }`; the PDF documents it under the heading "Business Process" with a `Field  Details` table. Extracted (5 fields) and reviewed in DOC_ONLY_REVIEWED instead; NOT_IN_PDF is empty. The must-have "BusinessProcess absence is recorded" is therefore recorded as presence here; sf-skills VENDOR.md's "Missing upstream: BusinessProcess" is unchanged and still true.
2. **[Rule 1 - Bug] `pdftotext -v`** exits 0 on poppler 26.04 and prints on stderr; the version probe now uses `spawnSync` and reads stderr regardless of exit code.
3. **[Rule 3 - Blocking] Three parser cases not in the plan's description** were needed to reach coverage: `Field  Field Type` headers (Opportunity/Task extracted 0 fields otherwise), `(beta)` name qualifiers (Organization/User `Address`, ServiceContract `BillingAddress`/`ShippingAddress`; also leaked "address" into `User.AccountId` Refers To), and bulleted field groups with a shifted details column (Account PersonMailing*/PersonOther*). Labels are now matched by text, not column.
4. **Small extension:** `Limit: N characters` also yields `maxLength` (BusinessProcess prints lengths that way). Numbers only; no prose.
5. Acceptance grep `grep -l '"Description"' …` matches the field *named* Description (`"Description": {`) in 23 files, not a prose key; no `"description"` key and no `"Description": "<string>"` exists. The test asserts the per-field key set is exactly `type, properties, maxLength, refersTo, relationshipName, relationshipType, gating`.

## Requirements
Plan frontmatter lists BASE2-01, BASE2-03, MIGR-03. None ticked here: BASE2-01 was completed by 09-01; BASE2-03 (gated fields in the baseline) and MIGR-03 (MasterDetail refusal) become true only when the generator (09-04+) consumes this extraction.

## Verification
- `pnpm lint`: clean. `pnpm typecheck:scripts`: clean. `tsc -p tsconfig.test.json`: no errors in the new test.
- `pnpm vitest run packages/metadata/test/object-reference-snapshot.test.ts packages/metadata/test/sfdocs-vendor.test.ts`: 7 passed.
- Not run: the full suite (unchanged packages; only data files and a scripts/ tool were added) and Docker Postgres.

## Known Stubs
None. Empty `KNOWN_GAPS`-style entries are reviewed data, not stubs.

## Self-Check: PASSED
Files (gating.ts, snapshot-lists.ts, snapshot-pdf.ts, source/object-reference/VENDOR.md + 35 JSON, object-reference-snapshot.test.ts) and commits 0bcc7f8, c8749fa, c8a9b67 exist; `git ls-files` holds no PDF or raw text.
