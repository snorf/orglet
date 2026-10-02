---
created: 2026-10-01T11:00:34.045Z
title: Reword ROADMAP phase 7 to validate against the DE retrieve, not the org
area: planning
files:
  - .planning/ROADMAP.md:14
  - README.md
---

## Problem

`.planning/ROADMAP.md` line 14 says the final conformance re-run "validates the sum of all six
changes against Johan's real Developer Edition org". That is not what phase 7 does: ACCEPT-01
and the phase 7 success criteria run `orglet check` against the *metadata retrieved* from the
Developer Edition (the local SFDX project in `~/Development.nosync/devrandom-metadata`). The
org itself is never contacted and orglet's behaviour is never compared with Salesforce's.

The wording matters because `PROJECT.md` and `README.md` promise that no Salesforce service is
used for benchmarking and that behaviour is never diffed against a real org (Developer MSA:
no competitive use, no benchmarking). A reader of the roadmap could take line 14 as the
opposite. Raised by Johan on 2026-10-01 during the phase 2 discussion.

## Solution

Before or during phase 7 (`/gsd:discuss-phase 7` or the phase 7 plan):

- Change ROADMAP.md line 14 to "against the metadata retrieved from Johan's Developer Edition
  and both SDK conformance suites" (REQUIREMENTS.md ACCEPT-01, BASE-05 and ROLL-09 already say
  "retrieve" and need no change).
- Keep the Developer Edition retrieve local only: never in the repo, never in CI;
  `examples/acme` stays the fixture the suite runs on.
- Optionally add one sentence to README's non-affiliation/legal note stating that the author's
  own retrieved metadata is used as local test input and no org is contacted or compared.
