# Phase 12: sigha Resync & Formula Globals - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-23
**Phase:** 12-sigha-resync-formula-globals
**Areas discussed:** Upstream strategy and corpus baseline, $Api and request context, Colon syntax semantics, Registry surface for Phase 13

---

## Pending todos cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| Colon-syntax todo | Coincides with FORM-02; its proposals (Queue alias of Group, canonical Owner:Group, no local pre-processing) become locked decisions | ✓ |
| Standard-field-gaps todo | Baseline generator fields on the 18 business objects; would widen the phase beyond formulas | |

**User's choice:** Fold the colon-syntax todo only.
**Notes:** The standard-field todo is recorded as reviewed-not-folded (Phase 14 or a quick task).

---

## Upstream strategy and corpus baseline

### Q1: How does the phase get `!` and the colon syntax into the vendored sigha?

| Option | Description | Selected |
|--------|-------------|----------|
| Pin a fork commit now, PRs in parallel (recommended) | Claude merges feat/unary-bang + feat/polymorphic-colon-ref into an integration branch in snorf/sigha outside the repo; Johan opens the upstream PRs when he wants; VENDOR.md points at the fork commit until upstream merges | ✓ |
| Wait for upstream merge | Johan opens the PRs first; the phase pins a real upstream commit; phase stalls until merged | |
| Pin a fork commit, no PR plan | Fork pin, PR question left open | |

**User's choice:** Pin a fork commit now, PRs in parallel.

### Q2: How is the corpus baseline made checkable?

| Option | Description | Selected |
|--------|-------------|----------|
| Measure before/after, lock the count in a test (recommended) | Run the corpus tests on the current pin, record pass/total per corpus file, add an orglet-owned minimum-pass assertion outside the vendored tests | ✓ |
| Measure and document only | Numbers in VENDOR.md and SUMMARY, no assertion | |
| Trust vendored BASELINE = 1 | The vendored conformance tests already require 100 % of comparable rows; row count can shrink unseen | |

**User's choice:** Measure before/after and lock the count in a test.

### Q3: What about org-verified.json?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as today, outside the baseline (recommended) | File stays vendored; the locked pass count covers only salesforce-v2.json | ✓ |
| Count it into the baseline | Lock over both files; baseline depends on a file with unclear provenance | |
| Stop vendoring it | sync-sigha.sh stops copying org-verified.json and org-conformance.test.ts | |

**User's choice:** Keep as today, outside the baseline.

### Q4: How is the re-pin from fork to upstream handled once the PRs merge?

| Option | Description | Selected |
|--------|-------------|----------|
| Own /gsd:quick later (recommended) | Phase 12 ships with the fork pin; re-pin is a small quick task when upstream merges; VENDOR.md's pending section describes it | ✓ |
| Inside phase 12 if time allows | Conditional last step in the plan | |

**User's choice:** Own quick task later.

---

## $Api and request context

### Q1: Where does the host part of $Api.Partner_Server_URL_n / Enterprise_Server_URL_n come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Same as instance_url at login (recommended) | Request-derived base URL (x-forwarded-proto/host or Host header), as login.ts already produces instance_url | ✓ |
| Configured base URL | New env/flag such as ORGLET_BASE_URL, valid everywhere including outside a request | |
| Request-derived with config fallback | Header when a request exists, else ORGLET_BASE_URL | |

**User's choice:** Same as instance_url at login.

### Q2: What does $Api.Session_ID evaluate to?

| Option | Description | Selected |
|--------|-------------|----------|
| The request's bearer token (recommended) | Same string as access_token / SOAP sessionId; what Salesforce returns | ✓ |
| A masked/synthetic value | Derived id that does not leak the token into stored or logged formula values | |

**User's choice:** The request's bearer token.

### Q3: Behaviour when evaluated without a request (orglet up --import, direct engine use, tests)?

| Option | Description | Selected |
|--------|-------------|----------|
| Blank value, one aggregated warning (recommended) | $Api.* is blank; one UNSUPPORTED:formula-global warning per formula explaining the missing request context; save not blocked | ✓ |
| Blank value, silent | Blank without warning | |
| Runtime error blocking the save | Validation rule blocks, formula field errors; makes data import impossible | |

**User's choice:** Blank value, one aggregated warning.

### Q4: Which version suffixes n are accepted?

| Option | Description | Selected |
|--------|-------------|----------|
| Every integer n, formatted directly (recommended) | `_<n>` gives `<base>/services/Soap/u/<n>.0/<orgId>` (partner) resp. `/services/Soap/c/<n>.0/<orgId>` (enterprise); research confirms the shape | ✓ |
| Only orglet's advertised API versions | n must exist in the /services/data list; else compile error | |

**User's choice:** Every integer n.

---

## Colon syntax semantics

### Q1: What do Owner:Queue.X and Owner:Group.X match?

| Option | Description | Selected |
|--------|-------------|----------|
| Both = every Group row (recommended) | Canonical segment Owner:Group, Queue a pure alias; only queues can own records in Salesforce, so no Type filter | ✓ |
| Queue only Type = Queue, Group all | Owner:Queue.X blank when the Group row is not Type Queue | |

**User's choice:** Both match every Group row.

### Q2: How deep may a traversal continue after a typed qualifier?

| Option | Description | Selected |
|--------|-------------|----------|
| Like ordinary relationships, multiple levels (recommended) | After Owner:User the path continues as a normal User lookup with today's depth rules; loadParents continues when the type is given | ✓ |
| Only one leaf field in phase 12 | Owner:User.Email works, Owner:User.Manager.Email stays UNSUPPORTED:polymorphic-traversal | |

**User's choice:** Multiple levels, like ordinary relationships.

### Q3: Qualifier naming a declared target on a non-polymorphic lookup (e.g. Account:Account.Name on Contact, Owner:User.Name after Phase 9 narrowing)?

| Option | Description | Selected |
|--------|-------------|----------|
| Research decides; otherwise accept (recommended) | Researcher looks for public documentation; documented rule wins; if silent, accept the qualifier when the object is a declared target | ✓ |
| Always accept when the object is a target | No research; qualifier = target filter regardless of target count | |
| Compile error on non-polymorphic lookup | Colon only when referenceTo.length > 1 | |

**User's choice:** Research decides; otherwise accept.

---

## Registry surface for Phase 13

### Q1: How much of the "structured formula registry and dependency list" does phase 12 deliver?

| Option | Description | Selected |
|--------|-------------|----------|
| Per formula: fields, global roots, volatility (recommended) | CompiledFormula gets a structured dependency list (fields per object incl. parent paths, $-roots used, NOW/TODAY/TIMENOW flag); FormulaRegistry exposes it per object/field; graph, reverse index and cycle detection are Phase 13's | ✓ |
| Full dependency graph now | Also reverse index and formula→formula cycle detection in phase 12 | |
| Only what the globals require | New reference kinds for label/cmdt/setup/api only | |

**User's choice:** Per formula: fields, global roots, volatility.

### Q2: $Setup on a Hierarchy setting when no level has a value?

| Option | Description | Selected |
|--------|-------------|----------|
| Research decides; otherwise blank (recommended) | Researcher checks whether Salesforce falls through to the field's defaultValue; documented behaviour wins; else blank | ✓ |
| Field defaultValue, else blank | Lock without research | |
| Always blank | Ignore field defaults entirely | |

**User's choice:** Research decides; otherwise blank.

### Q3: Next step

| Option | Description | Selected |
|--------|-------------|----------|
| Ready for context | Write CONTEXT.md and the log; remaining details go to research and Claude's discretion | ✓ |
| More questions about the registry | e.g. whether the dependency list shows in orglet check | |
| Explore more gray areas | $UserRole loading, $Label/$CustomMetadata keys, $Permission warning format | |

**User's choice:** Ready for context.

---

## Claude's Discretion

- Transport of request context (base URL, token) from the API layer to formula evaluation.
- Exact data shape of the dependency list and how FormulaRegistry exposes it.
- Whether $Label/$CustomMetadata are inlined at compile time or resolved from a static map at evaluation time.
- $Label casing and namespaced labels, $CustomMetadata record-key form, traversal of __mdt relationship fields, which UserRole fields $UserRole exposes.
- Name of the fork integration branch and how the sync is run against it.

## Deferred Ideas

- Re-pin from snorf/sigha to rfaulhaber/sigha after upstream merge (own quick task).
- Formula dependency list in the orglet check report (Phase 14).
- $Permission (security milestone); $Setup on List settings and label translations (v2, CSET-03).
- Serving the SOAP endpoints the $Api URLs point at (out of scope).
- Standard-field gaps todo (reviewed, not folded).
