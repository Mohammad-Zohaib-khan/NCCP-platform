# NCCP --- National Cooperative Capacity Building Platform {#nccp--national-cooperative-capacity-building-platform}

> **AI & LMS-Enabled Cooperative Capacity Building, ERP & Employment
> Ecosystem**\
> **Smart India Hackathon 2026 --- Problem Statement 26087**\
> **Team: Binary. Blades**

NCCP is a centralized, multilingual, installable **Progressive Web App
(PWA)** designed to connect cooperative-sector training, learning,
attendance, assessment, certification, skill development and employment
in one ecosystem.

**Journey:** Register → Train → Learn → Attend → Assess → Certify →
Skill Wallet → Employment

------------------------------------------------------------------------

## ⚠️ Current Prototype / Demo Status {#warning-current-prototype--demo-status}

This repository contains the NCCP software prototype/demo.

-   **No physical hardware is currently connected to the deployed
    demo.**
-   The Smart Training Hub is designed for **ESP32 + R307 fingerprint +
    QR/RFID** integration, but the physical device is not connected in
    the current deployment.
-   **ML/AI model integration is not included as a live dependency in
    the current demo.**
-   **AI/ML API keys are not included in this repository.**
-   Never commit API keys, passwords, database credentials or other
    secrets to GitHub.
-   AI is intended to be **assistive**; critical attendance, eligibility
    and certification decisions remain rule-based and auditable.
-   Hardware and external AI/ML services can be connected through the
    planned integration/API interfaces.

------------------------------------------------------------------------

## 🎯 Problem Statement {#dart-problem-statement}

Cooperative-sector training can involve multiple institutions,
programmes, trainees, trainers and employment pathways. Fragmented
records, manual attendance, disconnected learning systems and limited
employment linkage make it difficult to maintain a continuous view of a
trainee\'s journey.

NCCP addresses this by bringing the major training and employment
workflows into one platform.

------------------------------------------------------------------------

## 💡 Proposed Solution {#bulb-proposed-solution}

NCCP combines:

-   Centralized trainee and institution records
-   Multilingual web experience
-   Installable PWA --- no native app required
-   Role-based portals
-   Training ERP
-   LMS and assessments
-   Smart attendance
-   Certification
-   Verified Skill Wallet
-   Career assistance
-   Employer and job workflows
-   Analytics and reporting
-   Smart Training Hub hardware integration

------------------------------------------------------------------------

## 👥 Role-Based Access {#busts_in_silhouette-role-based-access}

  Role                        Main Responsibilities
  --------------------------- ----------------------------------------------------------------------------
  **NCCT Admin**              Platform administration, institutions, programmes, analytics and oversight
  **Institution Admin**       Institution operations, trainees, programmes, schedules and records
  **Trainer**                 Courses, sessions, attendance, assessments and learning activities
  **Trainee / Rural Youth**   Learning, assessments, attendance, certificates, skill wallet and jobs
  **Employer / Recruiter**    Jobs, candidate discovery, applications and skill-based hiring

------------------------------------------------------------------------

## 🧩 Core Modules {#jigsaw-core-modules}

### Training ERP

-   Programme registration and nomination
-   Institution and trainee management
-   Timetable, hostel and logistics support
-   Training progress tracking

### LMS & Assessments {#lms--assessments}

-   Course player and learning modules
-   Quizzes and assessments
-   Progress tracking
-   Multilingual learning support

### Smart Attendance

-   QR-based attendance
-   Face-recognition integration
-   Fingerprint integration
-   RFID/Smart Training Hub integration
-   Authorized manual correction with audit trail

### Certification

-   Completion and eligibility checks
-   Certificate workflow
-   Certificate verification support
-   Skill-linked credentials

### Skill Wallet

A structured trainee profile containing completed training, verified
skills, certifications, learning progress and employment information.

### AI Career Assistant

Supports:

-   Career roadmap
-   Skill-gap analysis
-   Course recommendations
-   Job recommendations
-   Resume guidance
-   Interview preparation
-   Project suggestions
-   Certification guidance

### Jobs & Employment {#jobs--employment}

-   Employer profiles
-   Job listings
-   Candidate discovery
-   Skill-based matching
-   Applications
-   Employment/placement workflow

------------------------------------------------------------------------

## 🌐 Multilingual & Rural-First Design {#globe_with_meridians-multilingual--rural-first-design}

-   English + Hindi
-   Architecture ready for additional regional languages
-   Responsive installable PWA
-   Low-bandwidth UX
-   Offline-ready learning approach
-   No native mobile app required

------------------------------------------------------------------------

## 🔌 Smart Training Hub {#electric_plug-smart-training-hub}

The hardware layer is designed around:

**ESP32 + R307 Fingerprint + QR/RFID**

Possible components:

-   ESP32
-   R307 fingerprint sensor
-   RC522 RFID reader
-   QR scanner/camera
-   OLED/LCD display
-   Buzzer/status indicators
-   Optional ESP32-CAM

### Hardware status

**The physical hardware is NOT connected to the current deployed demo.**

The software architecture is prepared for hardware integration through
APIs/provider interfaces when the device is available.

------------------------------------------------------------------------

## 🤖 AI / ML Integration {#robot-ai--ml-integration}

AI/ML is separated from critical deterministic workflows.

**AI can assist with:** career guidance, skill-gap analysis, course
recommendations, job recommendations, teaching content assistance and
recruiting assistance.

**Rule-based workflows:** attendance status, training eligibility,
certification eligibility and critical record updates.

### API / Model Status {#api--model-status}

The repository does **not** contain private AI/ML API keys.

If an external provider is used, configure credentials through
environment variables or a secure secret manager.

**Never hard-code API keys in source code.**

------------------------------------------------------------------------

## 🏗️ High-Level Architecture {#building_construction-high-level-architecture}

``` text
NCCP PWA
(Admin • Institution • Trainer • Trainee • Employer)
                    │
                    ▼
              REST API Layer
        Auth • RBAC • Validation • APIs
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    Training    Attendance    LMS / Jobs
      ERP          Engine      / Skills
        │           │           │
        └───────────┼───────────┘
                    ▼
                PostgreSQL
                    │
              ┌─────┴─────┐
              ▼           ▼
          File/Object  Analytics
           Storage     & Reports

Smart Training Hub
ESP32 → Fingerprint / QR / RFID → REST API → Attendance Engine
```

------------------------------------------------------------------------

## 📸 Project Screens / Prototype {#camera_flash-project-screens--prototype}

### 1. NCCP Installable PWA {#1-nccp-installable-pwa}



The PWA provides the main NCCP user experience without requiring a
native mobile application.

### 2. Smart Training Hub {#2-smart-training-hub}


Prototype hardware concept for attendance using ESP32, RFID and
fingerprint sensing.

> **Note:** The physical hardware is currently **not connected** to the
> deployed demo.

### 3. AI Career Assistant {#3-ai-career-assistant}



Trainee-facing career assistance for skills, courses, jobs, resumes and
interviews.

------------------------------------------------------------------------

## 📊 Impact & Benefits {#bar_chart-impact--benefits}

### Rural Youth & Trainees {#rural-youth--trainees}

-   Portable verified Skill Wallet
-   Local-language learning
-   Offline-ready learning
-   Direct job access

### Trainers

-   Automated attendance support
-   Assessment/grading support
-   AI-assisted lesson plans, quizzes and worksheets

### Employers

-   Certified and verified candidate access
-   Skill-based candidate matching
-   Reduced screening effort

### Institutions & NCCT {#institutions--ncct}

-   Live attendance and progress
-   Training outcome visibility
-   Reduced duplicate paperwork
-   Data for programme outreach and planning

### Broader Impact

**Social:** Inclusion of rural youth, SHGs and PACS members through
local-language access.

**Economic:** Skills can connect to jobs while reducing duplicated
administrative effort.

**Environmental:** Paperless registers, certificates and reports.

------------------------------------------------------------------------

## 🔐 Security & Trust Principles {#closed_lock_with_key-security--trust-principles}

-   Role-based access control
-   Server-side authorization
-   Password hashing
-   HTTPS in production
-   Validation and rate limiting
-   Audit logs for important actions
-   No raw fingerprint images stored in the NCCP database
-   Secrets kept outside source code
-   AI kept assistive for critical workflows

------------------------------------------------------------------------

## 🚀 Getting Started {#rocket-getting-started}

### Prerequisites

-   Node.js 20+
-   npm
-   PostgreSQL
-   Git

### Clone

``` bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd <PROJECT_DIRECTORY>
```

### Install

``` bash
npm install
```

### Environment

Create the environment file required by the project.

Example:

``` env
DATABASE_URL=your_database_connection
JWT_SECRET=your_secure_secret
AI_API_KEY=your_ai_api_key
```

> Replace placeholders locally. **Do not commit `.env` files or
> secrets.**

### Development

``` bash
npm run dev
```

### Production build

``` bash
npm run build
```

> If the repository uses separate frontend/backend directories, run the
> corresponding commands inside those directories.

------------------------------------------------------------------------

## 🧪 Demo Notes {#test_tube-demo-notes}

For the current hackathon demonstration:

1.  Demonstrate the PWA and role-based portals.
2.  Show the trainee LMS and learning journey.
3.  Demonstrate the software attendance workflow.
4.  Show the Smart Training Hub as the planned hardware integration.
5.  Demonstrate the AI Career Assistant.
6.  Show Skill Wallet and employment workflow.

### Current limitations

-   Physical attendance hardware is **not connected** to the current
    demo.
-   External AI/ML API credentials are **not included**.
-   Actual AI/ML execution depends on the configured provider/model.
-   Hardware integration requires the ESP32/R307/QR/RFID device and
    API/network configuration.

------------------------------------------------------------------------

## 📁 Suggested Repository Structure {#file_folder-suggested-repository-structure}

``` text
NCCP/
├── frontend/
├── backend/
├── ai-service/
├── hardware/
├── database/
├── docs/
│   └── images/
│       ├── nccp-pwa.png
│       ├── smart-training-hub.png
│       └── ai-career-assistant.jpeg
├── .env.example
├── .gitignore
└── README.md
```

Adjust names to match the actual repository structure.

------------------------------------------------------------------------

## 🔮 Future Enhancements {#crystal_ball-future-enhancements}

-   Physical ESP32 + R307 deployment
-   Production face-recognition provider
-   Additional regional languages
-   Expanded offline learning
-   Advanced analytics
-   External institutional integrations
-   Advanced AI recommendations
-   Production monitoring and deployment automation

------------------------------------------------------------------------

## 🏆 Smart India Hackathon {#trophy-smart-india-hackathon}

**Problem Statement:** 26087\
**Title:** AI & LMS-Enabled Cooperative Capacity Building, ERP &
Employment Ecosystem\
**Theme:** Smart Education\
**Category:** Hardware\
**Team:** Binary. Blades

NCCP is designed as a unified **training-to-employment ecosystem**
combining software, smart attendance hardware and assistive AI for
cooperative-sector capacity building.

------------------------------------------------------------------------

## 📄 License {#page_facing_up-license}

Add the project\'s selected license here before public release.

------------------------------------------------------------------------

## 👨‍💻 Team {#man_technologist-team}

**Binary. Blades**

Built for **Smart India Hackathon 2026**.
