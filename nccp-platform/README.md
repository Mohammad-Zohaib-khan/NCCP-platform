# NCCP Platform (National Cooperative Capacity Building Platform)

A unified training-to-employment ecosystem for India’s cooperative sector.

---

## Architecture & Workspaces

- **`frontend/`** - Production TanStack Start / Nitro SSR React application with full visual assets, supporting 5 authenticated stakeholder workspaces:
  - NCCT Super Admin
  - Institution Administrator
  - Trainer
  - Trainee / Rural Youth
  - Employer / Recruiter
- **`backend/`** - Production Node.js 22 Fastify / TypeScript API (PostgreSQL, RBAC, Auth/JWT/Cookies, Biometric Attendance, LMS, Certificates, Employment).
- **`nginx/`** - Production reverse proxy routing `/api/` to backend and root traffic to frontend SSR.
- **`docker-compose.yml`** - Single-command development and staging environment.
- **`docker-compose.prod.yml`** - Hardened production deployment configuration with isolated internal networking.
- **`DEPLOYMENT.md`** - Full production deployment guide.

---

## Quickstart

### Option 1: Docker (Recommended)
```bash
# 1. Copy environment file
cp .env.example .env

# 2. Build and start all services
docker compose up --build -d
```
Access the application at [http://localhost](http://localhost).

### Option 2: Local Development
**Backend:**
```bash
cd backend
npm install
npm run migrate
npm run dev # Runs on port 8080
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev # Runs on port 3000 (proxies /api to localhost:8080)
```

---

## Verification & Testing
- **Backend Tests:** `cd backend && npm test` (228/228 passing)
- **Backend Typecheck:** `cd backend && npm run typecheck` (0 errors)
- **Frontend Typecheck:** `cd frontend && npx tsc --noEmit` (0 errors)
- **Frontend Build:** `cd frontend && npm run build` (Clean build)
