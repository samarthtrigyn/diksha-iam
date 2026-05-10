# API Endpoint Reference

## Orchestrator-Mediated Authorization Code Flow

This document provides complete API reference for the new authorization flow.

---

## 1. POST /iam/login/start

**Purpose:** Initiate login for an identifier (email or phone)

### Request

```json
{
  "identifier": "user@example.com",
  "password": "optional-password"
}
```

**Headers:**
```
Content-Type: application/json
```

### Responses

#### 200 OK - ACTIVE User (No Password)
User exists in Keycloak. Return PKCE-based login URL.

```json
{
  "nextAction": "KEYCLOAK_LOGIN",
  "authUrl": "https://keycloak.example.com/realms/diksha-demo/protocol/openid-connect/auth?client_id=diksha-portal&response_type=code&scope=openid+profile+email&state=<uuid>&nonce=<hex>&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback&code_challenge=<base64url>&code_challenge_method=S256&login_hint=user%40example.com",
  "state": "550e8400-e29b-41d4-a716-446655440000",
  "userStatus": "ACTIVE"
}
```

**Frontend Action:** Redirect browser to `authUrl`

**Note:** `code_verifier` is **NOT** included. It's stored server-side and used later during callback.

---

#### 200 OK - ACTIVE User (With Password)
User exists in Keycloak and password is provided. Fetch token directly.

```json
{
  "nextAction": "LOGIN_SUCCESS",
  "accessToken": "eyJhbGc...",
  "idToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 300,
  "tokenType": "bearer",
  "userStatus": "ACTIVE"
}
```

**Frontend Action:** Store tokens and navigate to dashboard.

---

#### 200 OK - PASSWORD_PENDING User
User exists but not yet in Keycloak. Send OTP for verification.

```json
{
  "nextAction": "VERIFY_OTP",
  "txnId": "550e8400-e29b-41d4-a716-446655440001",
  "maskedIdentifier": "us****@example.com",
  "userStatus": "FIRST_TIME"
}
```

**Frontend Action:** 
1. Show OTP input screen
2. Call `POST /iam/activation/verify-otp` with `txnId` and OTP

---

#### 200 OK - PASSWORD_SETUP_INITIATED User
User completed OTP but didn't finish password setup. Return cached authUrl.

```json
{
  "nextAction": "SET_PASSWORD",
  "authUrl": "https://keycloak.example.com/realms/diksha-demo/protocol/openid-connect/auth?...",
  "state": "550e8400-e29b-41d4-a716-446655440002"
}
```

**Frontend Action:** Redirect browser to `authUrl` to complete password setup.

---

#### 400 Bad Request
```json
{
  "error": "identifier is required"
}
```

#### 403 Forbidden - Account Blocked
```json
{
  "error": "Account blocked. Please contact support."
}
```

#### 404 Not Found
```json
{
  "error": "User not found"
}
```

#### 429 Too Many Requests - Rate Limited
```json
{
  "error": "Too many OTP requests. Please wait and try again."
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## 2. POST /iam/activation/verify-otp

**Purpose:** Verify OTP and initiate password setup for new users

### Request

```json
{
  "txnId": "transaction-id-from-login-start",
  "identifier": "user@example.com",
  "otp": "123456",
  "codeChallenge": "optional-code-challenge"
}
```

**Notes:**
- `txnId` comes from `POST /iam/login/start` response
- `codeChallenge` is optional (orchestrator generates PKCE server-side)
- `otp` must be valid for the identifier

### Responses

#### 200 OK - OTP Verified
Orchestrator generates PKCE, activation token, and authorization URL.

```json
{
  "nextAction": "SET_PASSWORD",
  "authUrl": "https://keycloak.example.com/realms/diksha-demo/protocol/openid-connect/auth?client_id=diksha-portal&response_type=code&scope=openid+profile+email&state=<uuid>&nonce=<hex>&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback&code_challenge=<base64url>&code_challenge_method=S256&login_hint=user%40example.com&activation_token=<jwt>",
  "state": "550e8400-e29b-41d4-a716-446655440003"
}
```

**Frontend Action:**
1. Redirect browser to `authUrl`
2. Keycloak will show password setup form (due to custom activation_token authenticator)
3. User sets password
4. Keycloak redirects back to frontend with `code` and `state`

**Server Action (Backend):**
- Creates/updates Keycloak user with `UPDATE_PASSWORD` required action
- Caches this entire response in Redis for 5 minutes (for retry handling)
- Stores `code_verifier` server-side (indexed by `state`)

---

#### 400 Bad Request - Invalid Transaction
```json
{
  "error": "Invalid or expired transaction"
}
```

#### 400 Bad Request - OTP Verification Failed
```json
{
  "error": "OTP verification failed. Remaining attempt count is 1.",
  "remainingAttempts": 1
}
```

#### 400 Bad Request - Missing Fields
```json
{
  "error": "txnId, identifier, otp and codeChallenge are required"
}
```

#### 500 Internal Server Error - Keycloak Failure
```json
{
  "error": "Failed to provision Keycloak account"
}
```

---

## 3. POST /iam/auth/callback

**Purpose:** Exchange authorization code for tokens (server-side, orchestrator-mediated)

### Request

```json
{
  "code": "authorization-code-from-keycloak",
  "state": "state-value-from-keycloak-redirect"
}
```

**Headers:**
```
Content-Type: application/json
```

**Note:** Frontend does **NOT** send `code_verifier`. It's stored server-side and retrieved using `state`.

### Response

#### 200 OK - Success
Complete session context with tokens and profile.

```json
{
  "user": {
    "id": "keycloak-user-subject-uuid",
    "username": "user@example.com",
    "email": "user@example.com",
    "name": "John Doe",
    "iamUserId": "iam-service-user-id"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJrZXktMTIzIn0.eyJleHAiOjE2MzA3MDMyNzksImlhdCI6MTYzMDcwMzI3OSwianRpIjoiZWFkZjA4ZWQtZGFhNS00ODk4LWI2NTUtY2FhYmY5MjE5ZDdjIiwiaXNzIjoiaHR0cDovL2tleWNsb2FrOjgwODAvcmVhbG1zL2Rpa3NoYS1kZW1vIiwiYXVkIjoiZGlrc2hhLXBvcnRhbCIsInN1YiI6ImZhMzQyYjU5LTEyM2UtNGFiYy1hYmNkLTExMjIzMzQ0NTU2NiIsInR5cCI6IkJlYXJlciIsImF6cCI6ImRpa3NoYS1wb3J0YWwiLCJzZXNzaW9uX3N0YXRlIjoiOTk5MzQxOTItMTJlZi00YjIzLWEyMjItMTEyMzQ1Njc4OTBhIn0.signature",
    "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJrZXktMTIzIn0.eyJleHAiOjE2MzA3MDM1NzksImFjciI6IjEiLCJub25jZSI6IjMyY2Q3YWFkYWNhYjE0ZmI5YjY5ZTJmZTczYjkwNDAwIiwiYXV0X3RpbWUiOjAsImlzcyI6Imh0dHA6Ly9rZXljbG9hazoxNjA4MC9yZWFsbXMvZGlrc2hhLWRlbW8iLCJhdWQiOlsiZGlrc2hhLXBvcnRhbCJdLCJzdWIiOiJmYTM0MmI1OS0xMjNlLTRhYmMtYWJjZC0xMTIyMzM0NDU1NjYiLCJ0eXAiOiJJRCIsImF6cCI6ImRpa3NoYS1wb3J0YWwiLCJzZXNzaW9uX3N0YXRlIjoiOTk5MzQxOTItMTJlZi00YjIzLWEyMjItMTEyMzQ1Njc4OTBhIiwibmFtZSI6IkpvaG4gRG9lIiwicHJlZmVycmVkX3VzZXJuYW1lIjoidXNlckBleGFtcGxlLmNvbSIsImdpdmVuX25hbWUiOiJKb2huIiwiZmFtaWx5X25hbWUiOiJEb2UiLCJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0.signature",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 300,
    "tokenType": "bearer"
  },
  "roles": ["user", "admin"],
  "clientRoles": ["app-user", "app-admin"],
  "migrationStatus": "ACTIVE"
}
```

**Frontend Action:**
1. Store `tokens` (typically in secure storage or HTTP-only cookies)
2. Store `user` profile information
3. Use `accessToken` for subsequent API calls
4. Navigate to dashboard

**Server Action (Backend):**
1. ✅ Validated state (not expired, exists)
2. ✅ Retrieved server-side `code_verifier`
3. ✅ Exchanged `code` with Keycloak using `code_verifier`
4. ✅ Validated ID token claims (issuer, audience, nonce, expiry)
5. ✅ Validated access token claims (issuer, expiry)
6. ✅ Updated migration status if needed (PASSWORD_SETUP_INITIATED → ACTIVE)
7. ✅ Cleaned up state store

---

#### 400 Bad Request - Invalid/Expired State
```json
{
  "error": "Invalid or expired state"
}
```

**Cause:** 
- State not found in server store
- State has expired (> 10 minutes)
- User didn't complete callback within timeout

**Solution:** User must restart login flow by calling `POST /iam/login/start` again.

---

#### 400 Bad Request - Authorization Code Invalid/Expired
```json
{
  "error": "Authorization failed. Code may be invalid or expired."
}
```

**Cause:**
- Authorization code already used
- Authorization code expired (> 10 minutes)
- Code was tampered with
- Code is for wrong client_id

**Solution:** User must restart login flow.

---

#### 400 Bad Request - Token Validation Failed
```json
{
  "error": "Token validation failed: Invalid nonce: expected abc123 got def456"
}
```

**Possible Errors:**
- `Invalid issuer: expected http://keycloak:8080/realms/diksha-demo got ...`
- `Invalid audience: diksha-portal not in [other-client]`
- `Invalid nonce: expected ... got ...`
- `Token expired at 2024-01-15T10:30:00.000Z`

**Cause:** Token is invalid or from wrong source. This should not happen unless:
- Keycloak configuration changed
- KEYCLOAK_URL environment variable is wrong
- Token was intercepted and modified

**Solution:** Check server configuration and logs. Contact support if issue persists.

---

#### 400 Bad Request - Missing Code or State
```json
{
  "error": "code and state are required"
}
```

**Cause:** Frontend didn't include `code` and `state` in request body.

**Solution:** Ensure callback handler extracts parameters from URL correctly.

---

#### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

**Cause:** Unexpected server error (e.g., database issue, service unavailable).

**Solution:** Check server logs and retry. Contact support if issue persists.

---

## 4. POST /auth/token-exchange (DEPRECATED)

**Status:** Endpoint is deprecated and no longer recommended.

### Response

#### 410 Gone
```json
{
  "error": "This endpoint is deprecated. Use POST /iam/auth/callback instead.",
  "hint": "Frontend should send code and state to /iam/auth/callback, not this endpoint."
}
```

**Action:** Frontend should migrate to `POST /iam/auth/callback`.

---

## 5. GET /iam/me

**Purpose:** Get current user profile from access token

### Request

```
GET /iam/me
Authorization: Bearer <accessToken>
```

### Response

#### 200 OK
```json
{
  "id": "keycloak-subject",
  "email": "user@example.com",
  "username": "user@example.com",
  "name": "John Doe",
  "roles": ["user", "admin"],
  "migrationStatus": "ACTIVE",
  "keycloakClaims": {
    "exp": 1630703579,
    "iat": 1630703279,
    "jti": "eadf08ed-daa5-4898-b655-caabf9219d7c",
    "iss": "http://keycloak:8080/realms/diksha-demo",
    "aud": "diksha-portal",
    "sub": "fa342b59-123e-4abc-abcd-112233445566",
    "typ": "Bearer",
    "azp": "diksha-portal",
    "session_state": "999341921-12ef-4b23-a222-112345678901a"
  }
}
```

#### 401 Unauthorized
```json
{
  "error": "Missing Authorization header"
}
```

#### 401 Unauthorized - Invalid Token
```json
{
  "error": "Invalid token format"
}
```

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend Browser                              │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ 1. POST /iam/login/start
                                   │    { identifier }
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        IAM Orchestrator (4000)                          │
│                                                                         │
│  1. Check user status in Keycloak                                       │
│  2. Generate PKCE: code_verifier (server-side), code_challenge          │
│  3. Generate state and nonce                                            │
│  4. Store: stateStore[state] = {code_verifier, nonce, ...}              │
│  5. Return: authUrl (with code_challenge, NOT code_verifier)            │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                    2. Return authUrl and state
                                   │
                                   ▼
                        Frontend redirects to Keycloak
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Keycloak (8080)                                 │
│                                                                         │
│  1. Show login form                                                      │
│  2. User authenticates                                                   │
│  3. Validate PKCE code_challenge                                        │
│  4. Generate authorization code                                         │
│  5. Redirect to: frontend/auth/callback?code=XXX&state=YYY             │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                    3. Redirect with code + state
                                   │
                                   ▼
                Frontend /auth/callback handler
                 Extract code and state from URL
                                   │
                                   │ 4. POST /iam/auth/callback
                                   │    { code, state }
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        IAM Orchestrator                                  │
│                                                                         │
│  1. Validate state in stateStore                                        │
│  2. Retrieve stored: code_verifier, nonce                               │
│  3. Exchange code with Keycloak using code_verifier                     │
│  4. Validate token claims: issuer, audience, nonce, expiry              │
│  5. Update migration status if needed                                    │
│  6. Build session context: user, tokens, roles                          │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                    5. Return session context
                                   │
                                   ▼
                   Frontend stores tokens and profile
                    Navigates to dashboard
```

---

## Summary Table

| Endpoint | Method | Purpose | Frontend Sends | Backend Returns |
|----------|--------|---------|-----------------|-----------------|
| `/iam/login/start` | POST | Start login | identifier | authUrl, state |
| `/iam/activation/verify-otp` | POST | Verify OTP | txnId, otp, identifier | authUrl, state |
| `/iam/auth/callback` | POST | Exchange code | code, state | tokens, profile |
| `/auth/token-exchange` | POST | *DEPRECATED* | - | 410 Gone |
| `/iam/me` | GET | Get profile | auth header | user profile |

---

## Security Checklist

✅ Code_verifier is **never** sent to frontend
✅ Code_verifier is generated server-side using 96 bytes of entropy
✅ PKCE code_challenge uses SHA256
✅ State is validated with 10-minute expiry
✅ Nonce is generated and validated
✅ Token issuer is validated
✅ Token audience is validated
✅ Token expiry is validated
✅ State store is cleaned after callback
✅ Code can only be used once
✅ Authorization code has limited lifetime (10 min)

