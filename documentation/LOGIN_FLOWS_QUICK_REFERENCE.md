# DIKSHA IAM - Login Flows Quick Reference

## 🚀 Three Login Scenarios

---

### 1️⃣ NEW USER REGISTRATION + LOGIN (5 Steps)

```
┌─────────────────────────────────────────────────────────────┐
│ FLOW 1: New User Registration & Login                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ 1. Register Init     │  POST /iam/auth/register/init
│ {identifier}         │  Response: {txnId, nextStep: SEND_OTP}
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Send OTP          │  POST /iam/auth/register/send-otp
│ {txnId}              │  Response: {status: OTP_SENT, nextStep: VERIFY_OTP}
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 3. Verify OTP        │  POST /iam/auth/register/verify-otp
│ {txnId, otp}         │  Response: {status: OTP_VERIFIED, nextStep: SET_PASSWORD}
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 4. Complete Register │  POST /iam/auth/register/complete
│ {txnId, password}    │  Response: {user, nextStep: LOGIN}
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 5. Login Direct Grant│  POST /iam/auth/login/direct-grant
│ {identifier, pwd}    │  Response: {user, tokens, sessionId}
└──────────────────────┘
           │
           ▼
      ✅ SUCCESS
   (User logged in with JWT tokens)
```

---

### 2️⃣ EXISTING ACTIVE USER LOGIN (1 Step)

```
┌─────────────────────────────────────────────────────────────┐
│ FLOW 2: Active User Direct Login                            │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ Login Direct Grant   │  POST /iam/auth/login/direct-grant
│ {identifier, pwd}    │  Response: {user, tokens, sessionId}
└──────────────────────┘
           │
           ▼
      ✅ SUCCESS
   (User logged in with JWT tokens)
```

---

### 3️⃣ FIRST-TIME USER LOGIN (5 Steps)

```
┌─────────────────────────────────────────────────────────────┐
│ FLOW 3: First-Time User (Registration + Login)              │
└─────────────────────────────────────────────────────────────┘

[Same as Flow 1 - 5 steps]

Register Init → Send OTP → Verify OTP → Complete → Login
           │
           ▼
      ✅ SUCCESS
   (First-time user now logged in)
```

---

## 📊 Response Structure Summary

### Registration Responses (Steps 1-4)

| Endpoint | Status | nextStep |
|----------|--------|----------|
| `/iam/auth/register/init` | - | `SEND_OTP` |
| `/iam/auth/register/send-otp` | `OTP_SENT` | `VERIFY_OTP` |
| `/iam/auth/register/verify-otp` | `OTP_VERIFIED` | `SET_PASSWORD` |
| `/iam/auth/register/complete` | - | `LOGIN` |

### Login Response (Step 5 or Flow 2)

```json
{
  "user": {
    "userId": "UUID",
    "username": "string",
    "email": "string",
    "activationStatus": "ACTIVE"
  },
  "tokens": {
    "accessToken": "JWT",
    "idToken": "JWT",
    "refreshToken": "JWT",
    "expiresIn": 300,
    "tokenType": "Bearer"
  },
  "sessionId": "UUID"
}
```

---

## 🔑 Key Response Fields

### txnId
- Unique transaction ID
- Tracks registration across 4 steps
- NOT needed for login

### nextStep
- `SEND_OTP` → User clicks "Send OTP"
- `VERIFY_OTP` → User enters 6-digit OTP
- `SET_PASSWORD` → User creates password
- `LOGIN` → User proceeds to login

### status (OTP flows)
- `OTP_SENT` → OTP delivered (60s resend cooldown)
- `OTP_VERIFIED` → OTP validation passed

### tokens (login)
- **accessToken**: For API requests (5 min TTL)
- **idToken**: User identity claims
- **refreshToken**: For token renewal (1 hour TTL)

### sessionId
- Secure session identifier
- Stored in httpOnly cookie
- 1 hour TTL

---

## 🧪 Testing

**Mock OTP Code**: `123456`

**Example curl commands**:

```bash
# Flow 1: Step 1 - Register Init
curl -X POST http://localhost:4000/iam/auth/register/init \
  -H "Content-Type: application/json" \
  -d '{"identifier":"newuser@diksha.local"}'

# Flow 1: Step 2 - Send OTP
curl -X POST http://localhost:4000/iam/auth/register/send-otp \
  -H "Content-Type: application/json" \
  -d '{"txnId":"<txnId-from-step-1>"}'

# Flow 1: Step 3 - Verify OTP
curl -X POST http://localhost:4000/iam/auth/register/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"txnId":"<txnId>","otp":"123456"}'

# Flow 1: Step 4 - Complete Registration
curl -X POST http://localhost:4000/iam/auth/register/complete \
  -H "Content-Type: application/json" \
  -d '{
    "txnId":"<txnId>",
    "password":"Pass@123456",
    "confirmPassword":"Pass@123456",
    "termsAccepted":true
  }'

# Flow 1: Step 5 / Flow 2 - Direct Grant Login
curl -X POST http://localhost:4000/iam/auth/login/direct-grant \
  -H "Content-Type: application/json" \
  -d '{
    "identifier":"newuser@diksha.local",
    "password":"Pass@123456",
    "clientId":"diksha-portal"
  }'
```

---

## ⚙️ Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| OTP Code | `123456` | Development only |
| OTP Max Attempts | 3 | Per transaction |
| OTP TTL | 30 minutes | Valid for 30 min |
| Access Token TTL | 5 minutes (300s) | JWT expiry |
| Refresh Token TTL | 1 hour | For token renewal |
| Session TTL | 1 hour | httpOnly cookie |
| Resend Cooldown | 60 seconds | Between OTP sends |

---

## 🔒 Security Features

✅ **Registration**:
- Email/phone encryption in IAM DB
- OTP validation (max 3 attempts)
- Secure password requirements
- Terms acceptance verification

✅ **Login**:
- Keycloak Direct Grant (OAuth2 Resource Owner Password Credentials)
- JWT tokens with cryptographic signatures
- Secure httpOnly session cookies
- 5-minute access token TTL (short-lived)

✅ **Session**:
- Unique session IDs
- Redis-backed session store
- 1-hour TTL
- Automatic expiration

---

## 📝 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/iam/auth/register/init` | POST | Initialize registration |
| `/iam/auth/register/send-otp` | POST | Request OTP delivery |
| `/iam/auth/register/verify-otp` | POST | Verify OTP code |
| `/iam/auth/register/complete` | POST | Create user account |
| `/iam/auth/login/direct-grant` | POST | Login with credentials |

---

## 🚫 PKCE Removal Status

❌ **Removed**:
- Authorization Code flow
- PKCE code challenge/verifier exchange
- OAuth2 state management (for Keycloak)
- Redirect URIs to `/iam/auth/callback`

✅ **Kept**:
- Direct Grant (password) flow for main auth
- PKCE minimal support for social login (Google SSO)
- OTP-based registration & reset-password

---

## 📍 Current State

✅ All flows tested and working
✅ Response structures standardized
✅ Docker services running
✅ Real Keycloak tokens returned
✅ Session management working
✅ User creation in both IAM DB and Keycloak

🔧 Frontend integration: Ready (Login.tsx already implemented)
