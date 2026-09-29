# Part 6 - Employers, jobs, applications, interviews, placements

Status is tracked per phase. Each phase ships as its own complete project zip.

| Phase | Scope | Status |
|---|---|---|
| 6A | Migration 0010, `placements:read` permission, pure rules (employer verification, job lifecycle, application stages, interviews, placements, match score), unit tests | Written; 30 new unit tests pass |
| 6B | Employers (public apply, admin verify, members), jobs (CRUD, publish/pause/resume/close), trainee discovery | Not started |
| 6C | Applications (apply, withdraw, stage moves, history), interviews, offer and placement in one transaction, integration tests, final docs | Not started |

## Phase 6A - what exists

### Migration 0010 (`0010_part6_employment.sql`)
- Seeds the new permission `placements:read` (super admin, institution admin, employer, trainee). `src/auth/permissions.ts` has the same change and `test/permissions.test.ts` now compares 0006 + 0007 + 0010 with the code catalogue.
- Trigger `application_status_history_no_update`: history rows can be inserted but never edited. DELETE stays possible on purpose so `ON DELETE CASCADE` from a hard-deleted job still works; the services never delete history.
- Indexes `employers_status_idx` and `placements_job_idx`.
- Next free migration: **0011**.

### Rules (`src/modules/employment/employment.rules.ts`, pure)
| Area | Rule |
|---|---|
| Employer | `verify` and `reject` from unverified/pending; `suspend` from verified; `reinstate` from suspended; `reopen` from rejected. `reject` and `suspend` need a reason of at least 3 characters (422). Anything else is 409. Suspension reasons live in the audit trail like institutions (no column). |
| Job | `publish` draft to active, `pause` active to paused, `resume` paused to active, `close` from draft/active/paused. Publish and resume need a verified employer (409 `EMPLOYER_NOT_VERIFIED`). Closed is final and read-only. Publishing needs title, a description of 20+ characters, openings 1+, a location (or Remote), and a deadline that is a real date and not in the past; all problems are reported together (422). |
| Discovery | Open for applications only when the job is active, its employer is verified, and the deadline (if any) has not passed (the last day still counts). |
| Application | review, shortlisted, interview, offer, placed, one step at a time. `reject` (reason required) and `withdraw` (trainee only) from any open stage. placed, rejected, withdrawn are final. Wrong actor is 403, wrong stage is 409. |
| Interview | Must be in the future and within a year; video needs an http(s) link, in-person needs an address, phone needs nothing. Status: scheduled to confirmed/completed/cancelled/no_show, confirmed to completed/cancelled/no_show, all outcomes final. |
| Placement | confirmed to joined or not_joined; joined to left. Confirmed and joined placements occupy an opening; a job cannot place more people than `openings` (409 `OPENINGS_FILLED`). |

### Match score (documented formula, no AI)
Stored on the application when a trainee applies. 0-100, two decimals.
- **Skills, 60**: required-skill overlap 45 + preferred-skill overlap 15. If the job lists only one of the two lists, that list takes all 60. If it lists no skills the component is neutral (30) so listing nothing neither helps nor hurts.
- **Location, 20**: Remote work mode gives 20; the trainee's location, district or state contained in the job location (or the reverse, at least 3 characters) gives 20; a job with no location gives a neutral 10; otherwise 0.
- **Certification, 20**: the trainee holds a live (issued, not revoked) NCCP certificate.
Skills compare as whole entries after trimming, lower-casing and collapsing whitespace. "solar" does not match "solar wiring": exact matching is predictable and explainable; fuzzy matching is a later, separate decision. The result also returns matched and missing required skills so the UI can explain the number. It is an ordering aid for employers, not a decision.

### Decisions taken (defaults; change on request)
| Decision | Taken |
|---|---|
| Employer onboarding | Public application creates a pending employer (same idea as institutions: always 202, one pending per contact email); NCCP admin verifies; admin links employer users (6B) |
| Who verifies | Super admin only (`employers:verify`) |
| Offer details | The offer is a stage; salary and joining date are recorded on the placement when the application moves to placed (one transaction, 6C) |
| Openings | A job never auto-closes when full; further placements are refused instead |
| Suspended employer | Its active jobs disappear from discovery and cannot take new applications; existing applications stay readable |
| Institution admins | Can read placements of their own trainees (`placements:read`); they do not see applications, interview notes or employer notes |
| Job text | Employer-entered text is stored as entered and not machine-translated |

### Tests
`test/part6-rules.test.ts` (30 tests): every employer/job/application/interview/placement transition from every wrong state, reasons, actor checks, publish validation reporting all problems, salary range, interview time and link rules, openings cap, weights sum to 100, skill parsing and caps, exact-match rule, neutral values, score bounds over 200 generated cases, and hand-computed scores. `test/permissions.test.ts` (existing) now covers migration 0010.

### Not verified
Migration 0010 passed only the structural SQL lint, never PostgreSQL (the trigger function and the two indexes are the parts to watch). Nothing in 6A touches the database or HTTP.
