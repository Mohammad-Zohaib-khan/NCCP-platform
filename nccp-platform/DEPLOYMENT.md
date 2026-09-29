# NCCP Production Deployment Guide

National Cooperative Capacity Building Platform (NCCP)
A unified training-to-employment ecosystem for India’s cooperative sector.

---

## 1. Architecture Overview

The NCCP platform is structured into four containerized tiers:

1. **Nginx Reverse Proxy (`proxy`)**:
   - Port 80 (HTTP) & 443 (HTTPS)
   - Routes `/api/` traffic to the backend API (`api:8080`)
   - Routes all other traffic to the frontend SSR web server (`frontend:3000`)
   - Handles SSL termination, gzip compression, rate limiting, and security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`)

2. **Frontend Web Server (`frontend`)**:
   - Node.js 22 Alpine multi-stage Docker container running TanStack Start / Nitro SSR (`node .output/server/index.mjs`)
   - Port 3000 (internal network)
   - Dynamic role-based workspaces for:
     - NCCT Super Admin
     - Institution Administrator
     - Trainer
     - Trainee / Rural Youth
     - Employer / Recruiter

3. **Backend API (`api`)**:
   - Node.js 22 Fastify / TypeScript production API server
   - Port 8080 (internal network)
   - Strictly enforces role-based access control (RBAC), scrypt-hashed passwords, secure cookie refresh tokens, biometric attendance verification, digital certificate issue/revocation, and job matching pipelines.
   - Built-in zero-downtime database migration engine (`node dist/db/migrate.js up`)

4. **Database (`db`)**:
   - PostgreSQL 16 Alpine
   - Persistent Docker volume `pgdata` / `nccp_db_data`
   - Automated health checks via `pg_isready`

---

## 2. Quickstart Deployment (Local / Staging)

To build and spin up the complete platform locally:

```bash
cd nccp-platform

# 1. Copy environment variables template
cp .env.example .env

# 2. Build and launch all 4 services
docker compose up --build -d

# 3. Check container status
docker compose ps

# 4. View live logs
docker compose logs -f
```

The application is now accessible at:
- **Web Portal**: [http://localhost](http://localhost) (or [http://localhost:3000](http://localhost:3000))
- **API Health Check**: [http://localhost/healthz](http://localhost/healthz)
- **API Base**: [http://localhost/api/v1](http://localhost/api/v1)

---

## 3. Seed Credentials (Ready to Test)

The migration and seed runner automatically initializes demo credentials for all 5 stakeholder roles:

| Role | Email | Password |
|---|---|---|
| **Super Admin** | `admin@nccp.gov.in` | `Admin@12345` |
| **Institution Admin** | `institute@nccp.gov.in` | `Institute@12345` |
| **Trainer** | `trainer@nccp.gov.in` | `Trainer@12345` |
| **Trainee / Youth** | `trainee@nccp.gov.in` | `Trainee@12345` |
| **Employer / Recruiter** | `employer@nccp.gov.in` | `Employer@12345` |

*(Note: Change these passwords immediately in production environments).*

---

## 4. Production Deployment on a Cloud Server (AWS / GCP / Azure / DigitalOcean / VPS)

### Step 1: Server Provisioning
- **OS**: Ubuntu 22.04 LTS or 24.04 LTS
- **Specs**: Minimum 2 vCPU, 4GB RAM, 40GB SSD
- Install Docker & Docker Compose:
  ```bash
  sudo apt update && sudo apt install -y docker.io docker-compose-plugin
  sudo systemctl enable --now docker
  ```

### Step 2: Clone & Configure
```bash
git clone <repository_url> nccp
cd nccp/nccp-platform

# Configure production environment
cp .env.example .env
nano .env
```

Ensure the following variables are configured with high-entropy cryptographic keys (minimum 32 characters):
- `POSTGRES_PASSWORD`: Strong password
- `AUTH_JWT_SECRET`: Random 32+ character key
- `AUTH_COOKIE_SECRET`: Distinct random 32+ character key
- `APP_BASE_URL`: e.g. `https://your-domain.gov.in`
- `FRONTEND_ORIGINS`: e.g. `https://your-domain.gov.in`
- `AUTH_COOKIE_SECURE`: `true`

### Step 3: Run Production Stack
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### Step 4: SSL Certificate Setup (Let's Encrypt / Certbot)
To enable HTTPS:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --webroot -w ./nginx/certbot -d your-domain.gov.in
```
Mount the certificates into `./nginx/nginx.conf` and restart the proxy container:
```bash
docker compose -f docker-compose.prod.yml restart proxy
```

---

## 5. Maintenance & Operations

### Database Migrations
Migrations run automatically on container startup. To inspect status manually:
```bash
docker compose exec api node dist/db/migrate.js status
```

### Database Backup & Restore
**Backup:**
```bash
docker compose exec db pg_dump -U nccp -d nccp -F c -b -v -f /tmp/backup.dump
docker cp nccp-db:/tmp/backup.dump ./backup_$(date +%Y%m%d).dump
```

**Restore:**
```bash
docker cp ./backup.dump nccp-db:/tmp/backup.dump
docker compose exec db pg_restore -U nccp -d nccp -v -c /tmp/backup.dump
```

### Viewing Logs
```bash
# All logs
docker compose logs -f

# Backend API logs only
docker compose logs -f api

# Nginx access & error logs
docker compose logs -f proxy
```

---

## 6. Verification Checklist

- [x] Backend compilation: 0 TypeScript errors
- [x] Backend test suite: 228/228 passing
- [x] Migration integrity: 10 SQL migrations validated with optimistic lock triggers
- [x] Frontend compilation: 0 TypeScript errors (`tsc --noEmit`)
- [x] Frontend production bundle: Nitro `node-server` builds cleanly
- [x] Real API authentication: AuthContext wired to `/api/v1/auth/login` and `/api/v1/auth/refresh`
- [x] Reverse proxy configuration: Nginx routing `/api` to backend and root to frontend
- [x] Multi-stage Dockerfiles: Non-root users, minimal Alpine base images, healthcheck endpoints
