# DIKSHA IAM Demo - Keycloak 24 + IAM User Service Login Activation Flow

A complete local demonstration of a migration-safe login activation flow using **Keycloak 24** and an existing **IAM User Service**, with OTP verification and password setup via OIDC Authorization Code + PKCE.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser (localhost)                       │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React + Vite)  │  Keycloak Auth UI                   │
│  Port: 5173               │  Port: 8080                         │
└──────────┬────────────────────────────────────┬─────────────────┘
           │                                    │
           ▼                                    ▼
      ┌─────────────┐                  ┌─────────────────┐
      │ Orchestrator│                  │    Keycloak 24  │
      │ Port: 4000  │◄────────────────►│   + PostgreSQL  │
      │ (Express)   │                  │    Port: 8080   │
      └─────┬───────┘                  └─────────────────┘
            │
            │ (Docker network)
            ▼
      ┌────────────────────┐
      │ IAM User Service   │
      │ Port: 3000         │
      │ (External)         │
      └────────────────────┘
```

## Flow Diagram

```
User                Frontend              Orchestrator         Keycloak         IAM Service
│                      │                      │                   │                 │
├─ Enter Email ───────►│                      │                   │                 │
│                      │                      │                   │                 │
│                      ├─ POST /login/start ─►│                   │                 │
│                      │                      │                   │                 │
│                      │                      ├─ Check User ──────────────────────►│
│                      │                      │◄─ User Exists ────────────────────┤
│                      │                      │                   │                 │
│                      │◄──── nextAction: VERIFY_OTP ─────────────┤                 │
│                      │       (if PASSWORD_PENDING)               │                 │
│                      │                      │                   │                 │
│◄─ Show OTP Screen ──┤                      │                   │                 │
│                      │                      │                   │                 │
├─ Enter OTP ─────────►│                      │                   │                 │
│                      │                      │                   │                 │
│                      ├─ POST /verify-otp ──►│                   │                 │
│                      │   (with PKCE challenge)                  │                 │
│                      │                      │                   │                 │
│                      │                      ├─ Verify OTP ──────────────────────►│
│                      │                      │◄─ OTP Valid ──────────────────────┤
│                      │                      │                   │                 │
│                      │                      ├─ Create/Update Keycloak User ────►│
│                      │                      │  (with UPDATE_PASSWORD action)    │
│                      │                      │◄─ User Created ───────────────────┤
│                      │                      │                   │                 │
│                      │◄────── Keycloak Auth URL ──────────────┤                 │
│                      │        (with PKCE challenge)             │                 │
│                      │                      │                   │                 │
│◄─ Redirect ─────────┤                      │                   │                 │
│                      │                      │                   │                 │
├──────────────────────────────────────────────────────────────────────────────────►│
│                                                                 │ (Keycloak)     │
│                                        Set Password            │                 │
│◄──────────────────────────────────────────────────────────────────────────────────┤
│                                                                 │                 │
├─ Password Set ──────────────────────────────────────────────────────────────────►│
│                                                                 │                 │
│◄──────────────────── Auth Code + State ─────────────────────────────────────────┤
│                      │                      │                   │                 │
│                      ├─ Exchange Code (PKCE) ────────────────────►│                 │
│                      │                      │    with code_verifier (from storage)│
│                      │                      │                   │                 │
│                      │                      │◄────── Access Token ──────────────┤
│                      │                      │                   │                 │
│                      ├─ GET /iam/me ───────►│                   │                 │
│                      │   (with access token)│                   │                 │
│                      │                      │                   │                 │
│                      │                      ├─ Fetch User ──────────────────────►│
│                      │                      │◄─ User Profile ───────────────────┤
│                      │                      │                   │                 │
│                      │◄──── User Profile ──┤                   │                 │
│                      │      (+ roles, orgs) │                   │                 │
│                      │                      │                   │                 │
│◄─ Dashboard ────────┤                      │                   │                 │
│                      │                      │                   │                 │
```

## Services

### 1. **Keycloak 24** (Identity Provider)
- **Image:** `quay.io/keycloak/keycloak:24.0.2`
- **URL (Browser):** `http://localhost:8080`
- **URL (Docker Network):** `http://keycloak:8080`
- **Database:** PostgreSQL 15
- **Realm:** `diksha-demo`
- **Clients:**
  - `diksha-portal` (frontend, public, PKCE enabled)
  - `iam-admin-client` (backend service account)

### 2. **IAM Orchestrator** (Express.js)
- **Port:** `4000`
- **URL:** `http://localhost:4000`
- **Function:** Bridge between frontend, Keycloak, and IAM User Service
- **APIs:**
  - `POST /iam/login/start` - Initiate login
  - `POST /iam/activation/verify-otp` - Verify OTP and create Keycloak user
  - `GET /iam/me` - Get user profile
  - `GET /iam/keycloak-login-url` - Get Keycloak auth URL

### 3. **Demo Frontend** (React + Vite)
- **Port:** `5173`
- **URL:** `http://localhost:5173`
- **Pages:**
  - `/login` - Email/phone login
  - `/verify-otp` - OTP verification
  - `/auth/callback` - Keycloak callback
  - `/dashboard` - User profile and tokens

### 4. **IAM User Service** (External)
- **Port:** `3000`
- **Location:** Running as `iam-service` container
- **Endpoints Used:**
  - `GET /users?email=...&isEncrypted=false`
  - `GET /users?phone=...&isEncrypted=false`
  - `GET /users/{id}`
  - `POST /otp/generate`
  - `POST /otp/verify`
  - `PATCH /users/{id}`

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for development)
- Internet access to pull Docker images
- **IAM User Service running on `iam-service:3000`** (already running)

## Setup & Installation

### 1. Clone or download this repository

```bash
cd /home/samarthnigam/projects/diksha-iam
```

### 2. Ensure IAM User Service is running

```bash
docker ps | grep iam-service
# CONTAINER ID   IMAGE              COMMAND                  STATUS       PORTS
# 90ce4f8ea7e5   diksha-iam-iam-service   "docker-entrypoint..."  Up 8 hours   0.0.0.0:3000->3000/tcp
```

### 3. Build and start all services

```bash
docker-compose up --build
```

**Wait for all services to be healthy:**
- Keycloak: Ready when "KEYCLOAK_IMPORT: Realm data imported"
- Orchestrator: Ready when "IAM Orchestrator running on port 4000"
- Frontend: Ready when "VITE v5.x.x ready in Nms"

### 4. Create seed user (optional, if not pre-created)

```bash
curl -X POST http://localhost:3000/users?isEncrypted=false \
  -H "Content-Type: application/json" \
  -d '{
    "firstname": "Ratul",
    "lastname": "Mukhopadhyay",
    "dob": "1990-01-15",
    "email": "ratul003@example.com",
    "phone": "9876543298",
    "activationStatus": "PASSWORD_PENDING"
  }'
```

## Test Flow

### Step 1: Open Frontend

```
http://localhost:5173
```

### Step 2: Enter Email/Phone

Enter one of the following:
- `ratul003@example.com` (email)
- `9876543298` (phone)

### Step 3: Verify OTP

Enter: `123456` (demo OTP)

### Step 4: Set Password in Keycloak

Keycloak will redirect you to the password setup page. Create a password.

### Step 5: View Dashboard

After password setup, you'll be redirected back to the dashboard showing:
- User profile from IAM service
- Keycloak claims (sub, username, email)
- Decoded JWT token
- Raw access token
- Assigned roles and organizations

## API Documentation

### POST /iam/login/start

**Request:**
```json
{
  "identifier": "ratul003@example.com"
}
```

**Response (User not found):**
```json
{
  "nextAction": "USER_NOT_FOUND"
}
```

**Response (Activation required):**
```json
{
  "nextAction": "VERIFY_OTP",
  "txnId": "uuid-string",
  "maskedIdentifier": "ra***@example.com"
}
```

**Response (Already active):**
```json
{
  "nextAction": "KEYCLOAK_LOGIN",
  "redirectUrl": "http://localhost:8080/realms/diksha-demo/protocol/openid-connect/auth?..."
}
```

### POST /iam/activation/verify-otp

**Request:**
```json
{
  "txnId": "uuid-string",
  "identifier": "ratul003@example.com",
  "otp": "123456",
  "codeChallenge": "pkce-challenge-string",
  "redirectUri": "http://localhost:5173/auth/callback"
}
```

**Response:**
```json
{
  "nextAction": "SET_PASSWORD",
  "redirectUrl": "http://localhost:8080/realms/diksha-demo/protocol/openid-connect/auth?..."
}
```

### GET /iam/me

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "user": {
    "id": "user-id",
    "firstname": "Ratul",
    "lastname": "Mukhopadhyay",
    "email": "ratul003@example.com",
    "phone": "9876543298",
    "dob": "1990-01-15",
    "activationStatus": "ACTIVE"
  },
  "roles": ["LEARNER"],
  "orgs": [
    {
      "orgId": "diksha-demo-org",
      "role": "LEARNER"
    }
  ],
  "keycloak": {
    "sub": "keycloak-user-id",
    "preferred_username": "ratul003@example.com",
    "email": "ratul003@example.com",
    "given_name": "Ratul",
    "family_name": "Mukhopadhyay"
  }
}
```

## Configuration

### Environment Variables

**Orchestrator (`.env` in `iam-orchestrator/`):**
```env
NODE_ENV=development
PORT=4000
IAM_USER_SERVICE_URL=http://iam-service:3000
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=diksha-demo
KEYCLOAK_CLIENT_ID=iam-admin-client
KEYCLOAK_CLIENT_SECRET=iam-admin-client-secret
FRONTEND_REDIRECT_URI=http://localhost:5173/auth/callback
CORS_ORIGIN=http://localhost:5173,http://localhost:8080
```

**Frontend (`.env` in `frontend/`):**
```env
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=diksha-demo
VITE_KEYCLOAK_CLIENT_ID=diksha-portal
VITE_ORCHESTRATOR_URL=http://localhost:4000
```

### Keycloak Configuration

**Admin Console:** `http://localhost:8080/admin`
- Username: `admin`
- Password: `admin_password`

**Realm:** `diksha-demo`
- **Display Name:** DIKSHA Demo
- **Theme:** diksha-demo

**Clients:**
1. **diksha-portal** (Public)
   - Standard Flow: ✓ Enabled
   - PKCE: ✓ S256 Required
   - Redirect URIs: `http://localhost:5173/auth/callback`
   - Web Origins: `http://localhost:5173`

2. **iam-admin-client** (Confidential)
   - Service Account: ✓ Enabled
   - Client Secret: `iam-admin-client-secret`
   - Grant Types: Client Credentials

**Roles:**
- LEARNER
- INSTRUCTOR
- ADMIN

**Required Actions:**
- UPDATE_PASSWORD (priority: 30)

## Troubleshooting

### 1. Keycloak internal URL vs browser URL

**Problem:** Orchestrator can't reach Keycloak, or redirect URLs are wrong.

**Solution:**
- Inside Docker network: Use `http://keycloak:8080`
- From browser: Use `http://localhost:8080`
- Verify `KC_HOSTNAME=localhost` in docker-compose.yml

**Test:**
```bash
# From orchestrator container
curl http://keycloak:8080/health/ready

# From host
curl http://localhost:8080/health/ready
```

### 2. CORS Error: "Access to XMLHttpRequest blocked"

**Problem:** Frontend requests to orchestrator fail with CORS error.

**Solution:**
- Ensure `CORS_ORIGIN` in orchestrator includes `http://localhost:5173`
- Verify frontend makes requests to `http://localhost:4000`, not internal URL

**Check:**
```bash
curl -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS http://localhost:4000/iam/login/start -v
```

### 3. Redirect URI Mismatch

**Problem:** "redirect_uri_mismatch" error from Keycloak.

**Solution:**
- Ensure Keycloak client `diksha-portal` has correct redirect URI: `http://localhost:5173/auth/callback`
- Check `FRONTEND_REDIRECT_URI` in orchestrator matches

**Verify in Keycloak Admin:**
1. Go to Clients > diksha-portal
2. Settings tab
3. Check "Valid Redirect URIs"

### 4. PKCE code_verifier missing

**Problem:** Token exchange fails, "Missing code_verifier" from Keycloak.

**Solution:**
- Frontend must generate PKCE before calling `/iam/login/start`
- Store `code_verifier` in sessionStorage
- Retrieve it in callback page before token exchange

**Check:** Open browser DevTools > Application > Session Storage > `pkce_code_verifier`

### 5. OTP Verification Fails

**Problem:** OTP endpoint returns error.

**Solution:**
- Verify IAM User Service is running: `docker ps | grep iam-service`
- Verify OTP endpoint: `curl http://localhost:3000/otp/verify -X POST ...`
- For demo, OTP should be `123456`

**Test:**
```bash
curl -X POST http://localhost:3000/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "request": {
      "key": "ratul003@example.com",
      "type": "email",
      "otp": "123456"
    }
  }'
```

### 6. User not found in IAM service

**Problem:** Login page says "User not found".

**Solution:**
- Ensure user exists in IAM service
- Check with curl: `curl http://localhost:3000/users?email=ratul003@example.com&isEncrypted=false`
- Create user if missing (see "Create seed user" section)

### 7. Keycloak user creation fails

**Problem:** Orchestrator logs "Failed to create Keycloak user".

**Solution:**
- Verify `iam-admin-client` service account has permissions
- Check Keycloak admin token can be obtained: `curl http://keycloak:8080/realms/diksha-demo/protocol/openid-connect/token ...`
- Ensure client secret is correct: `iam-admin-client-secret`

**Check Keycloak logs:**
```bash
docker logs keycloak | grep -i "error"
```

### 8. Frontend blank or 404

**Problem:** Frontend page doesn't load or shows 404.

**Solution:**
- Verify frontend container is running: `docker ps | grep demo-frontend`
- Check URL: `http://localhost:5173` (not 5173/src or others)
- Rebuild if needed: `docker-compose up --build demo-frontend`

### 9. "Cannot find module" errors in orchestrator

**Problem:** Orchestrator crashes with module not found.

**Solution:**
- Ensure `package.json` is in correct location: `/iam-orchestrator/package.json`
- Rebuild: `docker-compose up --build iam-orchestrator`
- Check Dockerfile uses correct COPY commands

## Development

### Running locally (without Docker)

1. **Start Keycloak (in Docker):**
   ```bash
   docker-compose up keycloak keycloak-postgres
   ```

2. **Start IAM Orchestrator:**
   ```bash
   cd iam-orchestrator
   npm install
   npm run dev
   ```

3. **Start Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. **Access:** `http://localhost:5173`

### Debugging

**Orchestrator logs:**
```bash
docker logs iam-orchestrator -f
```

**Keycloak logs:**
```bash
docker logs keycloak -f | grep -i "error\|warning"
```

**Frontend browser console:**
- Open DevTools (F12)
- Go to Console tab
- Check for errors

## File Structure

```
diksha-iam/
├── docker-compose.yml                 # Main orchestration file
│
├── keycloak/
│   ├── realm-export.json              # Keycloak realm configuration
│   └── themes/
│       └── diksha-demo/
│           └── login/
│               ├── theme.properties   # Theme definition
│               ├── login.ftl          # Login page template
│               ├── update-password-required.ftl # Password setup page
│               ├── css/
│               │   └── login.css      # Theme styles
│               └── js/
│                   └── login.js       # Theme JavaScript
│
├── iam-orchestrator/
│   ├── Dockerfile                     # Orchestrator image
│   ├── package.json                   # Node.js dependencies
│   └── src/
│       └── index.js                   # Main application
│
├── frontend/
│   ├── Dockerfile                     # Frontend image
│   ├── package.json                   # React dependencies
│   ├── index.html                     # HTML entry point
│   ├── vite.config.js                 # Vite configuration
│   ├── .env                           # Environment variables
│   └── src/
│       ├── main.jsx                   # React entry point
│       ├── App.jsx                    # Main component
│       ├── index.css                  # Global styles
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── VerifyOtpPage.jsx
│       │   ├── CallbackPage.jsx
│       │   └── DashboardPage.jsx
│       ├── components/
│       └── utils/
│           ├── api.js                 # API client
│           └── pkce.js                # PKCE utilities
│
├── scripts/
│   └── seed-user.sh                   # Optional: Create test user
│
└── README.md                          # This file
```

## Key Concepts

### PKCE (Proof Key for Code Exchange)

Used to secure the authorization code flow for public clients (no client secret):

1. **Frontend** generates `code_verifier` (128 character random string)
2. **Frontend** computes `code_challenge = BASE64URL(SHA256(code_verifier))`
3. **Frontend** sends `code_challenge` to orchestrator
4. **Orchestrator** includes `code_challenge` in Keycloak auth URL
5. **Frontend** stores `code_verifier` in sessionStorage
6. **Keycloak** redirects to callback with authorization `code`
7. **Frontend** exchanges `code` + `code_verifier` for tokens

### Migration Status

- `LEGACY_ONLY` - User exists in IAM only
- `PASSWORD_PENDING` - User needs to set password in Keycloak
- `PASSWORD_SETUP_INITIATED` - User has set password, activation in progress
- `ACTIVE` - User fully activated

### Required Actions in Keycloak

The `UPDATE_PASSWORD` required action forces users to set a password on their next login. This is set during user creation/update by the orchestrator.

## Security Considerations

1. **Passwords never in IAM:** Passwords are stored and validated only in Keycloak
2. **No Resource Owner Password Flow:** Uses OIDC Authorization Code + PKCE (safer)
3. **State parameter:** Prevents CSRF attacks
4. **PKCE:** Protects against authorization code interception
5. **HTTPS in production:** Always use HTTPS in production, not HTTP
6. **CORS:** Restrict to known origins only
7. **Token storage:** In demo, stored in sessionStorage (memory only). In production, use httpOnly cookies or secure storage.

## Next Steps / Production Hardening

1. **Replace in-memory state store** with Redis or database
2. **Implement proper JWT validation** instead of manual decoding
3. **Add token refresh logic** (access token expiry ~5 min)
4. **Use HTTPS everywhere** with valid certificates
5. **Implement logout** with Keycloak session revocation
6. **Add user roles mapping** from Keycloak to IAM attributes
7. **Implement audit logging** for all authentications
8. **Add rate limiting** to prevent brute force
9. **Move secrets to vault** (HashiCorp Vault, AWS Secrets Manager)
10. **Set up monitoring and alerting** for failures

## Support & Debugging

### Check all services running

```bash
docker-compose ps
```

### View combined logs

```bash
docker-compose logs -f
```

### Restart a specific service

```bash
docker-compose restart iam-orchestrator
```

### Rebuild after code changes

```bash
docker-compose up --build [service-name]
```

### Clean up and restart

```bash
docker-compose down
docker-compose up --build
```

### Access Keycloak database

```bash
docker exec -it keycloak-postgres psql -U keycloak -d keycloak
```

## License

MIT

## Contact

For issues or questions, refer to the Keycloak documentation: https://www.keycloak.org/documentation.html
