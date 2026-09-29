# NCCP Production Backend --- Handover Brief & Remaining Work

## Updated v5 --- Part 6A continuation + Face Recognition

**State:** 29 Sep 2026

This document continues the uploaded NCCP v4 handover. Parts 1--4b are
documented as delivered but unverified against a real npm/PostgreSQL
environment. Part 4b already includes localized LMS, signed QR
attendance, a fingerprint provider with development-only Space-key
simulation, and an optional face path. Face recognition currently has no
provider and is disabled/returns 503. fileciteturn2file0L5-L10
fileciteturn2file0L38-L52

## 1. Current Status

  -----------------------------------------------------------------------
  Part                    Scope                   Status
  ----------------------- ----------------------- -----------------------
  1                       Foundation, migrations  Delivered; unverified
                          0001--0005, Docker, CI  

  2                       Auth, users, RBAC,      Delivered; DB/HTTP
                          sessions, MFA, audit    unverified

  3                       Institutions, trainers, Delivered; unverified
                          trainees, programmes,   
                          batches                 

  4                       Enrolments, LMS, class  Delivered; unverified
                          sessions, attendance,   
                          assessments             

  4b                      Multilingual LMS, QR,   Delivered; DB/HTTP
                          fingerprint prototype,  unverified
                          optional face, language 
                          preference              

  5                       Certificates/public     Verify whether 5A/5B/5C
                          verification            is complete in the
                                                  current ZIP

  6A                      Employer/recruitment    Continue from the
                          foundation              current Part 6A ZIP

  6B+                     Jobs, applications,     Remaining
                          interviews, placements  

  7                       Notifications,          Remaining
                          S3/files, audit API,    
                          settings, SMTP          

  8                       Dashboard               Remaining
                          aggregates/analytics    

  9                       Frontend API            Remaining
                          integration, login,     
                          multilingual UI,        
                          demo-data removal       

  10                      Seed, E2E/security,     Remaining
                          backups, monitoring,    
                          deployment,             
                          biometric/privacy       
                          review                  
  -----------------------------------------------------------------------

The v4 handover explicitly lists Parts 6--10 as remaining major work and
describes the frontend integration still required.
fileciteturn2file0L115-L147

## 2. Verification --- Must Be Completed

Before declaring production ready:

1.  `npm install`
2.  `npm run typecheck`
3.  `npm run lint:sql`
4.  `npm run migrate` twice; second run must be a no-op
5.  `RUN_DB_TESTS=1 npm test`
6.  Run server and verify `/healthz`, `/readyz`, `/api/v1`
7.  `npm run build`

The v4 handover states these have not yet been fully executed against
real dependencies/PostgreSQL. fileciteturn2file0L58-L76

## 3. Part 6A --- Continue, Do Not Rebuild

Use the exact Part 6A ZIP as the current source of truth. Preserve its
existing migrations, permissions, services, routes and tests.

Never edit shipped migrations. Add the next numbered migration when
schema changes are required. Keep the existing NCCP conventions:

-   server-side RBAC
-   organization scoping
-   out-of-scope records return 404
-   validation 422
-   unique conflicts 409
-   stale `If-Match` 412
-   audit writes inside transactions
-   cursor/keyset pagination
-   whitelisted sort keys
-   parameterized SQL

## 4. Remaining Part 6 Scope

### Employer

-   Registration
-   Admin verification
-   Employer profile
-   Employer users/permissions
-   Verified status
-   Only verified employers publish jobs

### Jobs

-   Create/edit/publish/pause/close
-   Search/filtering
-   Skills and eligibility
-   Location and employment metadata

### Applications

-   Trainee job discovery
-   Apply
-   Duplicate prevention
-   Withdraw
-   Status
-   Append-only status history

### Interviews / Offers / Placement

-   Interview scheduling
-   Interview status/history
-   Offers
-   Selection/rejection
-   Placement record
-   Transaction-safe final placement

### Candidate Matching

Keep the documented simple match formula: - skill overlap - location -
certification

Do not add a complex AI matching system unless explicitly required.

### Multilingual Employer Area

All employer UI labels, status text, forms and notifications must use
the global i18n system. Employer-entered job descriptions remain
employer-created content and are not automatically machine-translated.

## 5. Part 7 --- Remaining

-   Persistent notifications and delivery state
-   Real SMTP mailer with retry
-   Localized notification templates with language fallback
-   S3-compatible file storage
-   Upload type/size/content checks
-   Signed downloads and authorization
-   Rate limiting
-   Virus-scan hook
-   Read-only audit API
-   Settings API with history
-   Announcements
-   Enabled/default languages
-   Feature flags for QR, face recognition and fingerprint demo

The v4 handover specifies these Part 7 requirements and states that the
production fingerprint-demo block must remain in force.
fileciteturn2file0L123-L131

## 6. Part 8 --- Dashboards & Analytics

Replace hard-coded/demo metrics with real database aggregates for all
five workspaces.

Include: - training metrics - completion - attendance - certificates -
employment/placement - role-scoped reports - attendance breakdown by
manual/QR/fingerprint/face where appropriate

AI Monitoring and AI Recruitment Assistant remain data-backed
dashboards; no external AI service is required by default.
fileciteturn2file0L132-L136

## 7. Part 9 --- Frontend Integration

### API

Build one authenticated API client with: - in-memory access token 
refresh through HttpOnly cookie - request IDs - standardized errors -
single-flight refresh

### Authentication

-   Real login
-   MFA step
-   Logout
-   Role-protected routes

### Global Multilingual UI

The i18n system must cover: - landing page - authentication - all five
dashboards - navigation - buttons - tables - forms - dialogs -
validation - errors - empty states - settings - notifications -
attendance - LMS - employer workflows

Store language preference through the backend. localStorage may only be
a UX cache.

### E-learning

Course/module/lesson screens request the selected language and use the
documented fallback when translation is unavailable.

### Replace Demo Data

Remove authoritative localStorage/demo state from Admin, Institution,
Trainer, Trainee and Employer. Connect CRUD, pagination, loading, retry,
empty and permission states to APIs.

### Attendance UI

**QR:** trainer starts/ends session and shows rotating QR; trainee
scans/submits.

**Fingerprint:** minimal scanner state; Space-key simulation only when
the development flag is enabled. Never expose a production bypass.

**Face:** camera/verification UI behind a feature flag and provider
availability check. QR/manual remains fallback.

The v4 document explicitly describes these frontend requirements.
fileciteturn2file0L137-L152

# 8. Face Recognition --- What Must Actually Be Added

Face recognition is **not finished** in the current system. The handover
says it is off by default, has no provider, and returns 503.
fileciteturn2file0L49-L52

## Required minimal implementation

### Frontend

Add: - camera permission request - camera preview - capture/verification
state - success/failure state - retry - fallback to QR/manual

### Backend

Create a provider abstraction:

``` text
FaceRecognitionProvider
├── isAvailable()
├── verify(identity, image/frame)
└── release/cleanup if required
```

Add: - feature flag - provider availability state - face verification
endpoint - attendance integration - authorization - rate limiting -
duplicate prevention - audit/security handling

The attendance service must not be tied directly to a vendor/model.

## 9. Face Attendance Flow

``` text
Trainer opens attendance session
            ↓
Trainee selects Face
            ↓
Camera permission
            ↓
Capture controlled frame
            ↓
Face provider verification
            ↓
Backend validates:
  • authenticated trainee
  • batch membership
  • open session
  • attendance window
  • duplicate status
  • successful verification
            ↓
Attendance record: method = face
            ↓
Success
```

If face verification is unavailable or fails:

``` text
Face unavailable/fails
       ↓
QR attendance
       ↓
Manual attendance fallback
```

Do not implement continuous surveillance.

## 10. Face Data & Privacy

Do not unnecessarily store raw face images.

Prefer transient processing and only the minimum verification/audit
metadata required.

If biometric templates are ever stored: - protect/encrypt them -
restrict access - define retention - define deletion/revocation - define
consent/notice - define data residency - never expose biometric data
through normal APIs

The v4 handover explicitly says biometric consent, retention and
residency are currently undefined and must be addressed before
production biometric use. fileciteturn2file0L160-L162

## 11. Face Security Tests

Test: - wrong trainee - unauthorized trainee - no face - multiple
faces - failed verification - repeated attempts - duplicate attendance -
expired session - closed session - cross-organization access - provider
unavailable - QR/manual fallback

The frontend must never be able to submit `faceVerified=true` and make
the backend trust it.

## 12. Attendance Final Architecture

  -----------------------------------------------------------------------
  Method                              Role
  ----------------------------------- -----------------------------------
  Manual                              Required fallback/correction

  QR                                  Required primary self-check-in

  Face                                Optional biometric verification

  Fingerprint                         Hardware-ready provider;
                                      development simulator initially
  -----------------------------------------------------------------------

The core system must work even if face recognition is completely
disabled.

## 13. Part 10 --- Final Production Work

Still required: - seed data - first super-admin creation - E2E tests -
security tests - backup/restore - monitoring - error tracking - rollback
procedure - deployment documentation - versioned artifact - staging
acceptance - biometric/privacy review

Face-specific production testing must include failed verification,
replay/duplicate cases, unauthorized access, provider failure and
fallback.

## 14. Remaining Work --- Short Checklist

### Must finish

1.  Part 6 employer/jobs/applications/interviews/placements
2.  Complete/verify Part 5
3.  Part 7 notifications/files/audit/settings/SMTP
4.  Part 8 analytics
5.  Part 9 full frontend/API integration
6.  Platform-wide multilingual UI
7.  Multilingual LMS
8.  QR attendance frontend
9.  Face recognition provider + integration
10. Fingerprint hardware integration later
11. Seed data
12. E2E/security tests
13. PostgreSQL verification
14. Backups/monitoring/deployment

### Optional

-   Face recognition provider, until selected and privacy-reviewed

### Development only

-   Fingerprint Space-key bypass

## 15. Final Architecture

``` text
NCCP
│
├── React/TypeScript Frontend
│   ├── Global i18n
│   ├── 5 Role Dashboards
│   ├── Multilingual LMS
│   └── Attendance UI
│       ├── QR
│       ├── Face
│       ├── Fingerprint
│       └── Manual
│
├── Node/Fastify API
│   ├── Auth/RBAC
│   ├── Training/LMS
│   ├── Certificates
│   ├── Employer/Jobs
│   ├── Applications/Placement
│   ├── Notifications
│   ├── Files
│   ├── Analytics
│   └── Attendance
│       ├── QR provider
│       ├── Face provider
│       └── Fingerprint provider
│
├── PostgreSQL
├── S3-compatible object storage
└── Optional supporting services
```

## 16. Rules for the Next AI/Developer

-   Build from the current Part 6A ZIP, not memory.
-   Read existing `src/auth`, `src/lib`, `src/modules` and migrations
    before modifying anything.
-   Never edit shipped migrations.
-   Add new migrations sequentially.
-   Keep organization scoping and server-side RBAC.
-   Use the existing AppError/status-code conventions.
-   Audit mutations inside transactions.
-   Keep QR/manual as the reliable attendance baseline.
-   Face recognition is optional and must have a provider abstraction.
-   Fingerprint Space-key bypass is development-only and must never ship
    enabled in production.
-   Do not add unnecessary microservices or infrastructure.
-   At the end of each part, provide code, tests, notes, README/HANDOFF
    updates, a complete project ZIP, and a clear statement of what was
    actually executed versus only written.

## 17. Bottom Line

The biggest remaining work is **not just Part 6A**. The project still
needs Parts 6--10, frontend integration, real database verification and
production testing.

The new face-recognition requirement should be implemented as a **small,
replaceable provider layer integrated into the existing attendance
system**, not as a separate complex subsystem. QR and manual attendance
must continue working independently.
