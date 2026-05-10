# Orchestrator-Mediated Authorization Code Flow

## Overview

The IAM orchestrator now handles the complete PKCE-based OAuth2 authorization code flow on behalf of the frontend. This eliminates the need for the frontend to directly exchange authorization codes with Keycloak, improving security and separation of concerns.

## Key Changes

### 1. **PKCE Parameters Generated Server-Side**

**Helper Function: `generatePKCE()`**
- Generates a 128-character random `code_verifier` (using 96 bytes of entropy)
- Computes `code_challenge = base64url(sha256(code_verifier))`
- **Code_verifier is never exposed to the frontend**

```javascript
function generatePKCE() {
  const codeVerifier = Buffer.from(randomBytes(96)).toString('base64url');
  const hash = require('crypto').createHash('sha256');
  hash.update(codeVerifier);
  const codeChallenge = hash.digest('base64url');
  return { codeVerifier, codeChallenge };
}
```

### 2. **Token Validation Function**

**Helper Function: `validateTokenClaims()`**
- Validates JWT signature integrity (basic base64url format check)
- Validates issuer (iss claim)
- Validates audience (aud claim) - can be string or array
- Validates nonce (for ID tokens)
- Validates expiration (exp claim)

```javascript
function validateTokenClaims(token, expectedNonce, expectedIssuer, expectedAudience)
```

### 3. **Updated `/iam/login/start` for ACTIVE Users**

**Request:**
```json
{
  "identifier": "user@example.com",
  "password": null
}
```

**Process:**
1. ✅ Check user status in Keycloak
2. ✅ Generate PKCE `code_verifier` and `code_challenge` **server-side**
3. ✅ Generate `state` and `nonce`
4. ✅ Store `code_verifier`, `nonce`, and metadata in **stateStore** (indexed by `state`)
   - Key: `state`
   - Value: `{ identifier, iamUserId, codeVerifier, nonce, expiresAt }`
5. ✅ Build Keycloak authorization URL with `code_challenge` and `code_challenge_method=S256`
6. ✅ Return to frontend **without exposing code_verifier**

**Response:**
```json
{
  "nextAction": "KEYCLOAK_LOGIN",
  "authUrl": "https://keycloak.example.com/realms/diksha-demo/protocol/openid-connect/auth?...",
  "state": "uuid-state-value",
  "userStatus": "ACTIVE"
}
```

### 4. **Updated `/iam/activation/verify-otp` for New Users**

**Process:**
1. ✅ Verify OTP with IAM service
2. ✅ Create/update Keycloak user with `UPDATE_PASSWORD` required action
3. ✅ Generate PKCE `code_verifier` and `code_challenge` **server-side**
4. ✅ Generate activation token (short-lived, 10 min TTL)
5. ✅ Store `code_verifier` in **stateStore** along with activation metadata
6. ✅ Build Keycloak authorization URL with activation_token
7. ✅ Cache entire response in Redis for 5 minutes (for retry handling)

**Response:**
```json
{
  "nextAction": "SET_PASSWORD",
  "authUrl": "https://keycloak.example.com/realms/diksha-demo/protocol/openid-connect/auth?...",
  "state": "uuid-state-value"
}
```

### 5. **New Endpoint: `POST /iam/auth/callback`**

This endpoint replaces the deprecated `/auth/token-exchange`.

**Request:**
```json
{
  "code": "<authorization-code-from-keycloak>",
  "state": "<state-value>"
}
```

**Process:**

**Step 1: Validate State**
- Retrieve state data from stateStore
- Validate state has not expired
- Extract: `identifier`, `iamUserId`, `keycloakUserId`, `codeVerifier`, `nonce`, `migrationStatus`

**Step 2: Exchange Authorization Code**
- POST to Keycloak token endpoint
- Include:
  - `grant_type: "authorization_code"`
  - `code: <code-from-query-param>`
  - `code_verifier: <server-side-stored-verifier>`
  - `redirect_uri: FRONTEND_REDIRECT_URI`
  - `client_id: "diksha-portal"`

**Step 3: Validate ID Token Claims**
```javascript
validateTokenClaims(
  tokenResp.data.id_token,
  nonce,
  `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
  "diksha-portal"
)
```

Validates:
- ✅ Issuer matches Keycloak realm
- ✅ Audience includes 'diksha-portal' client
- ✅ Nonce matches what we generated
- ✅ Token has not expired

**Step 4: Validate Access Token Claims**
```javascript
validateTokenClaims(
  tokenResp.data.access_token,
  null,  // no nonce in access token
  expectedIssuer,
  null   // some servers don't set aud
)
```

**Step 5: Update Migration Status (if PASSWORD_SETUP_INITIATED)**
If user completed password setup via OTP flow:
```javascript
await migrationStore.set(identifier, {
  status: 'ACTIVE',
  keycloakUserId,
  iamUserId,
  keycloakSubject: idTokenPayload.sub,
  updatedAt: Date.now()
});
```

**Step 6: Build Session Context**
Resolve user profile and return session data

**Response:**
```json
{
  "user": {
    "id": "keycloak-subject",
    "username": "user@example.com",
    "email": "user@example.com",
    "name": "John Doe",
    "iamUserId": "iam-user-id"
  },
  "tokens": {
    "accessToken": "eyJhbGc...",
    "idToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "expiresIn": 300,
    "tokenType": "bearer"
  },
  "roles": ["user", "admin"],
  "clientRoles": ["app-user"],
  "migrationStatus": "ACTIVE"
}
```

### 6. **Deprecated Endpoint: `/auth/token-exchange`**

This endpoint now returns:
```json
{
  "error": "This endpoint is deprecated. Use POST /iam/auth/callback instead.",
  "hint": "Frontend should send code and state to /iam/auth/callback, not this endpoint."
}
```

HTTP Status: **410 Gone**

---

## Frontend Flow Changes

### Before (Client-Mediated Flow)
```
Frontend                    Keycloak              IAM Orchestrator
  |                             |                        |
  +------ /iam/login/start -------->
  |                             |
  |<------ authUrl, state -------+
  |                             |
  +---- redirect to authUrl ----->
  |                             |
  | (user enters password)       |
  |                             |
  |<----- code, state ----------+
  |                             |
  +------ /auth/token-exchange ---> (INSECURE: passes code_verifier)
  |                             |
  |<------ tokens ----------------+
  |
  (Store tokens in frontend)
```

### After (Orchestrator-Mediated Flow)
```
Frontend                    Keycloak              IAM Orchestrator
  |                             |                        |
  +------ /iam/login/start -------->
  |                             |
  |<------ authUrl, state -------+
  |                             |
  +---- redirect to authUrl ----->
  |                             |
  | (user enters password)       |
  |                             |
  |<----- code, state ----------+
  |                             |
  +------ /iam/auth/callback ------>
  |                             |
  |<------ tokens, profile -------+
  |
  (Store tokens in frontend)
```

## Frontend Responsibilities

1. ✅ Call `POST /iam/login/start` with identifier
2. ✅ Receive `authUrl` and redirect browser
3. ✅ Keycloak redirects back to `/auth/callback` in frontend
4. ✅ Extract `code` and `state` from URL
5. ✅ Send `code` and `state` to `POST /iam/auth/callback`
6. ✅ **Do NOT call Keycloak token endpoint directly**
7. ✅ **Do NOT store code_verifier**
8. ✅ Store returned tokens and profile
9. ✅ Navigate to dashboard

## Backend Responsibilities

1. ✅ Generate PKCE parameters server-side
2. ✅ Store `code_verifier` server-side (never expose to frontend)
3. ✅ Validate state on callback
4. ✅ Exchange code with Keycloak using stored code_verifier
5. ✅ Validate all JWT claims (issuer, audience, nonce, expiry)
6. ✅ Resolve IAM user profile
7. ✅ Update migration status if needed
8. ✅ Return complete session context

## Security Benefits

✅ **Code_verifier never exposed to browser** - Cannot be intercepted or stolen
✅ **State validation** - Prevents CSRF attacks
✅ **Nonce validation** - Prevents token replay attacks
✅ **Token claim validation** - Ensures tokens are from legitimate issuer
✅ **PKCE protection** - Even if code is intercepted, code_verifier is needed
✅ **Short expiry** - State and transaction data expire after 10 minutes
✅ **Separation of concerns** - Backend handles sensitive operations

## Error Handling

### Invalid/Expired State
```json
{
  "error": "Invalid or expired state"
}
```
HTTP Status: **400 Bad Request**

### Token Exchange Failed
```json
{
  "error": "Authorization failed. Code may be invalid or expired."
}
```
HTTP Status: **400 Bad Request**

### Token Validation Failed
```json
{
  "error": "Token validation failed: <reason>"
}
```
HTTP Status: **400 Bad Request**

Reasons:
- `Token expired at ...`
- `Invalid issuer: expected ... got ...`
- `Invalid audience: ... not in ...`
- `Invalid nonce: expected ... got ...`

---

## Configuration Required

Ensure these environment variables are set:

```bash
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_PUBLIC_URL=http://localhost:8080
KEYCLOAK_REALM=diksha-demo
FRONTEND_REDIRECT_URI=http://localhost:5173/auth/callback
```

## Database/Store Impact

### State Store (In-Memory, 10-minute TTL)
```
state → {
  identifier: "user@example.com",
  iamUserId: "iam-123",
  keycloakUserId: "kc-456",
  codeVerifier: "base64url-string",
  nonce: "hex-string",
  migrationStatus: "PASSWORD_SETUP_INITIATED" | null,
  expiresAt: timestamp
}
```

### Migration Store (Redis, 24-hour TTL)
```
migration:{identifier} → {
  status: "ACTIVE" | "PASSWORD_SETUP_INITIATED" | ...,
  keycloakUserId: "kc-456",
  iamUserId: "iam-123",
  keycloakSubject: "sub",
  updatedAt: timestamp
}
```

---

## Testing Checklist

- [ ] ACTIVE user can login via KEYCLOAK_LOGIN flow
- [ ] OTP verification redirects to password setup
- [ ] Password setup completes activation flow
- [ ] `/iam/auth/callback` validates state correctly
- [ ] Invalid state returns 400 error
- [ ] Expired code returns error
- [ ] Token claims are validated (issuer, nonce, expiry)
- [ ] Session context returned with tokens and profile
- [ ] `/auth/token-exchange` returns 410 Gone
- [ ] Frontend doesn't need to pass code_verifier

