# DIKSHA IAM Demo - Complete Setup Guide

A complete end-to-end Identity and Access Management (IAM) flow integrating:
- **IAM Service**: Real Cassandra-backed user database with OTP service
- **Keycloak 24**: OpenID Connect provider for OAuth/OIDC flows
- **Orchestrator**: Express.js bridge service coordinating IAM + Keycloak
- **Frontend**: React+Vite with professional DIKSHA UI
- **Mock OTP**: Toggle-based mock OTP for testing (no rate limits)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      User Flow                              │
│                                                             │
│  1. Login (Email/Phone)                                    │
│       ↓                                                    │
│  2. OTP Generation (Mock or Real IAM Service)            │
│       ↓                                                    │
│  3. OTP Verification → Keycloak User Creation            │
│       ↓                                                    │
│  4. Password Setup (Custom Form)                         │
│       ↓                                                    │
│  5. Keycloak OAuth (PKCE Flow)                          │
│       ↓                                                    │
│  6. Token Exchange → JWT                                 │
│       ↓                                                    │
│  7. Authenticated Session                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Backend Services (Docker Compose)              │
│                                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Keycloak 24    │  │  PostgreSQL  │  │ IAM Service  │ │
│  │  (OIDC/OAuth2)  │  │  (DB)        │  │ (Real/Mock)  │ │
│  └────────┬────────┘  └──────────────┘  └──────────────┘ │
│           │                                     │          │
│           └──────────────────┬──────────────────┘          │
│                              ↓                             │
│                   ┌────────────────────┐                  │
│                   │ Orchestrator (4000)│                  │
│                   │  Bridge Service    │                  │
│                   └────────────────────┘                  │
│                              ↑                             │
│           ┌──────────────────┴──────────────────┐         │
│           ↓                                     ↓         │
│    ┌──────────────┐                   ┌──────────────┐  │
│    │  Frontend    │                   │   Mock OTP   │  │
│    │  (React)     │                   │  (Togglable) │  │
│    └──────────────┘                   └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)
- Port 5173 (frontend), 4000 (orchestrator), 8080 (Keycloak), 3000 (IAM service)

### 1. Start All Services

```bash
cd /home/samarthnigam/projects/diksha-iam
docker compose up -d
```

This starts:
- **Keycloak** (port 8080): OIDC/OAuth2 provider
- **PostgreSQL**: Keycloak database
- **IAM Service** (port 3000): Real Cassandra-backed user database
- **Orchestrator** (port 4000): Bridge service
- **Frontend** (port 5173): React UI

### 2. Verify Services

```bash
# Check all services are running
docker compose ps

# View logs
docker compose logs keycloak  # Keycloak startup logs
docker compose logs iam-orchestrator  # Orchestrator logs
docker compose logs frontend  # Frontend build logs
```

### 3. Test End-to-End Flow

```bash
# Run the E2E test script
bash test-e2e.sh
```

Expected output:
```
=== ✅ ALL TESTS PASSED ===

User can now:
  1. Click the auth URL to go to Keycloak
  2. Log in with email: samarth.nigam@trigyn.com
  3. Password: SecurePass123!
  4. Receive authorization code
  5. Exchange for JWT token
```

## Detailed Flow

### Step 1: Login Page
**URL**: `http://localhost:5173/login`

User enters email or phone number:
```
Email: samarth.nigam@trigyn.com
```

**Backend**: `POST /iam/login/start`
```json
{
  "identifier": "samarth.nigam@trigyn.com"
}
```

**Response**:
```json
{
  "nextAction": "VERIFY_OTP",
  "txnId": "uuid",
  "maskedIdentifier": "sa***@trigyn.com"
}
```

### Step 2: OTP Verification Page
**URL**: `http://localhost:5173/verify-otp`

User enters OTP (demo: `123456`):
```
OTP: 123456
```

**Backend**: `POST /iam/activation/verify-otp`
```json
{
  "txnId": "uuid",
  "identifier": "samarth.nigam@trigyn.com",
  "otp": "123456",
  "codeChallenge": "pkce_challenge"
}
```

**What happens**:
1. ✅ OTP verified with IAM Service (mock or real)
2. ✅ User created in Keycloak with `UPDATE_PASSWORD` required action
3. ✅ Response includes setup token

**Response**:
```json
{
  "nextAction": "SET_PASSWORD",
  "setupToken": "uuid",
  "setupUrl": "http://localhost:5173/auth/setup-password?token=uuid"
}
```

### Step 3: Password Setup Page
**URL**: `http://localhost:5173/auth/setup-password?token=uuid`

User creates a password:
```
Password: SecurePass123!
Confirm: SecurePass123!
```

**Frontend**: Sends to `POST /auth/set-password`
```json
{
  "setupToken": "uuid",
  "password": "SecurePass123!",
  "codeChallenge": "pkce_challenge"
}
```

**What happens**:
1. ✅ Keycloak admin API sets user password
2. ✅ Clears `UPDATE_PASSWORD` required action
3. ✅ Generates auth URL with PKCE

**Response**:
```json
{
  "nextAction": "KEYCLOAK_LOGIN",
  "authUrl": "http://localhost:8080/realms/diksha-demo/protocol/openid-connect/auth?...",
  "state": "uuid"
}
```

### Step 4: Keycloak OAuth
**URL**: Redirected to Keycloak auth endpoint

Keycloak shows login form:
```
Email: samarth.nigam@trigyn.com (pre-filled via login_hint)
Password: SecurePass123!
```

User logs in → Keycloak returns authorization code

### Step 5: Auth Callback
**URL**: `http://localhost:5173/auth/callback?code=...&state=...`

Frontend automatically:
1. ✅ Extracts authorization code
2. ✅ Exchanges code for JWT token via `/auth/token-exchange`
3. ✅ Stores token in sessionStorage
4. ✅ Redirects to dashboard

**Response**:
```json
{
  "access_token": "eyJhbGc...",
  "id_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "expires_in": 60,
  "token_type": "Bearer"
}
```

### Step 6: Dashboard
**URL**: `http://localhost:5173/dashboard`

Authenticated user sees:
- User profile (from JWT claims)
- Token details
- Logout button

## API Endpoints

### IAM Orchestrator (Port 4000)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/iam/login/start` | Initiate login with email/phone |
| POST | `/iam/activation/verify-otp` | Verify OTP and create Keycloak user |
| POST | `/auth/set-password` | Set password for new user |
| POST | `/auth/token-exchange` | Exchange auth code for JWT token |
| GET | `/iam/me` | Get authenticated user profile |
| GET | `/health` | Service health check |

## Mock OTP Service

By default, the orchestrator uses **mock OTP** to avoid rate limits during development.

### Enable/Disable Mock OTP

```bash
# In docker-compose.yml, orchestrator service:
environment:
  USE_MOCK_OTP: "true"      # Enable mock (default)
  MOCK_OTP_CODE: "123456"   # Code to use for testing
```

**Mock OTP Details**:
- Code: `123456`
- Always succeeds
- Instant generation
- No rate limiting
- Real IAM service still validates user existence

### Switch to Real OTP

```bash
# In docker-compose.yml:
environment:
  USE_MOCK_OTP: "false"
```

Real OTP will:
- Call IAM Service for generation
- Proxy to real OTP provider (dev.oci.diksha.gov.in)
- Apply rate limiting (typically 3 attempts)
- Actually send SMS/Email

## Testing

### Run Full E2E Test

```bash
bash test-e2e.sh
```

### Test Individual Endpoints

**Login Start**:
```bash
curl -X POST http://localhost:4000/iam/login/start \
  -H "Content-Type: application/json" \
  -d '{"identifier": "samarth.nigam@trigyn.com"}'
```

**Verify OTP**:
```bash
curl -X POST http://localhost:4000/iam/activation/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "txnId": "uuid_from_login",
    "identifier": "samarth.nigam@trigyn.com",
    "otp": "123456",
    "codeChallenge": "pkce_challenge"
  }'
```

**Set Password**:
```bash
curl -X POST http://localhost:4000/auth/set-password \
  -H "Content-Type: application/json" \
  -d '{
    "setupToken": "uuid_from_verify",
    "password": "SecurePass123!",
    "codeChallenge": "pkce_challenge"
  }'
```

### Access Keycloak Admin Console

**URL**: `http://localhost:8080/admin`

**Credentials**:
- Username: `admin`
- Password: `admin_password`

View created users, manage clients, adjust settings.

## Configuration

### Keycloak Realm

**Realm**: `diksha-demo`

**Clients**:
1. `diksha-portal` (Public, PKCE S256)
   - Frontend OAuth client
   - Redirect URI: `http://localhost:5173/auth/callback`
   - PKCE required: Yes

2. `admin-cli` (Service account)
   - Used by orchestrator to manage users
   - Has full admin permissions on diksha-demo realm

### Environment Variables

**Orchestrator** (iam-orchestrator/.env):
```env
PORT=4000
IAM_USER_SERVICE_URL=http://iam-service:3000
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_PUBLIC_URL=http://localhost:8080
KEYCLOAK_REALM=diksha-demo
KEYCLOAK_ADMIN_PASSWORD=admin_password
USE_MOCK_OTP=true
MOCK_OTP_CODE=123456
CORS_ORIGIN=http://localhost:5173
FRONTEND_REDIRECT_URI=http://localhost:5173/auth/callback
```

**Frontend** (frontend/.env):
```env
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=diksha-demo
VITE_KEYCLOAK_CLIENT_ID=diksha-portal
VITE_API_BASE_URL=http://localhost:4000
```

## Troubleshooting

### Services Not Starting

```bash
# Check Docker logs
docker compose logs keycloak | tail -30
docker compose logs iam-orchestrator | tail -30

# Rebuild services
docker compose up -d --build
```

### OTP Verification Fails

1. **Check mock OTP is enabled**: `USE_MOCK_OTP=true`
2. **Use code `123456`**: Demo code for mock service
3. **Check orchestrator logs**: `docker compose logs iam-orchestrator | grep OTP`

### Keycloak User Not Created

1. **Check admin token**: Orchestrator needs valid admin credentials
2. **Verify realm exists**: Access http://localhost:8080/admin
3. **Check orchestrator logs**: `docker compose logs iam-orchestrator | grep KEYCLOAK`

### Token Exchange Fails

1. **Verify auth code valid**: Code only valid for ~60 seconds
2. **Check PKCE code verifier**: Frontend stores in sessionStorage
3. **Verify redirect URI matches**: Must exactly match Keycloak client config

## Development

### Local Development (Not Docker)

**Start orchestrator**:
```bash
cd iam-orchestrator
npm install
npm start
```

**Start frontend**:
```bash
cd frontend
npm install
npm run dev
```

**Note**: Update URLs in `.env` files to use `localhost` instead of Docker service names.

### Extending the System

**Add new OIDC provider**: Update orchestrator to support additional identity providers
**Custom password validation**: Add rules in `/auth/set-password` endpoint
**Multi-factor authentication**: Add TOTP/SMS verification after OTP
**User attributes**: Extend Keycloak user creation with custom attributes

## Production Considerations

1. **SSL/TLS**: Enable HTTPS for all endpoints
2. **Secrets management**: Use environment variables, not hardcoded values
3. **Database**: PostgreSQL should have proper backups and replication
4. **Rate limiting**: Add rate limiting to `/iam/login/start` and OTP endpoints
5. **CORS**: Restrict origins to trusted domains
6. **Token expiry**: Set appropriate JWT token lifetimes
7. **Monitoring**: Set up logging and alerting for auth failures
8. **Audit logs**: Log all auth events for compliance

## Support

For issues or questions:
1. Check Keycloak logs: `docker compose logs keycloak`
2. Check orchestrator logs: `docker compose logs iam-orchestrator`
3. Run E2E test: `bash test-e2e.sh`
4. Review configuration in `docker-compose.yml`

---

**Last Updated**: 2025-05-05
**Status**: ✅ Full E2E flow working with mock OTP
