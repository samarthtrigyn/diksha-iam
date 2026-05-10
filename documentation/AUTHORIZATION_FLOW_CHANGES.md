# Authorization Flow Implementation - Summary

## Changes Made

### 1. **New Helper Functions Added**

#### `generatePKCE()`
- Generates server-side PKCE parameters
- Returns: `{ codeVerifier, codeChallenge }`
- Used by: `/iam/login/start` and `/iam/activation/verify-otp`

#### `validateTokenClaims(token, expectedNonce, expectedIssuer, expectedAudience)`
- Validates JWT token integrity and claims
- Checks: format, expiry, issuer, audience, nonce
- Used by: `/iam/auth/callback`
- Throws: `Error` with descriptive validation failure reason

### 2. **Updated Endpoints**

#### `POST /iam/login/start` (ACTIVE user without password)
**Changes:**
- ✅ Now generates PKCE parameters server-side using `generatePKCE()`
- ✅ Stores `code_verifier` in stateStore (keyed by `state`)
- ✅ Stores `nonce` for later validation
- ✅ Returns authorization URL with `code_challenge` (NOT code_verifier)

**State Store Entry:**
```javascript
stateStore.set(state, {
  identifier,
  iamUserId,
  codeVerifier,    // NEW: server-side
  nonce,           // NEW: server-side
  expiresAt: Date.now() + 600_000
});
```

#### `POST /iam/activation/verify-otp`
**Changes:**
- ✅ Now generates PKCE parameters server-side using `generatePKCE()`
- ✅ Stores `codeVerifier` in transaction store for later retrieval
- ✅ Stores `codeVerifier` and `nonce` in stateStore on callback

**Transaction Store Entry (updated):**
```javascript
txnStore.set(txnId, {
  identifier,
  iamUserId,
  codeVerifier,    // NEW: server-side
  codeChallenge,   // NEW: server-side
  redirectUri,
  clientId,
  expiresAt: Date.now() + 600_000
});
```

**State Store Entry (updated):**
```javascript
stateStore.set(state, {
  identifier,
  iamUserId,
  keycloakUserId,
  codeVerifier,    // NEW: server-side
  nonce,           // NEW: server-side
  migrationStatus: 'PASSWORD_SETUP_INITIATED',
  expiresAt: Date.now() + 600_000
});
```

### 3. **New Endpoint: `POST /iam/auth/callback`**

This is the orchestrator-mediated authorization code exchange endpoint.

**Request:**
```json
{
  "code": "authorization-code-from-keycloak",
  "state": "state-value"
}
```

**Process:**
1. Validate state and retrieve server-side PKCE data
2. Exchange authorization code with Keycloak token endpoint
   - Uses server-side `code_verifier` (NOT from frontend)
   - Validates response is from correct Keycloak instance
3. Validate ID token claims:
   - Issuer matches Keycloak realm
   - Audience includes 'diksha-portal'
   - Nonce matches what we generated
   - Token not expired
4. Validate Access token claims (issuer, expiry)
5. Update migration status from PASSWORD_SETUP_INITIATED → ACTIVE (if applicable)
6. Build and return session context with:
   - User profile (id, username, email, name, iamUserId)
   - Tokens (access, id, refresh)
   - Roles (realm roles + client roles)
   - Migration status

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
    "accessToken": "eyJ...",
    "idToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 300,
    "tokenType": "bearer"
  },
  "roles": ["user"],
  "clientRoles": ["app-user"],
  "migrationStatus": "ACTIVE"
}
```

**Error Responses:**
- `400` - Invalid/expired state, authorization failed, or token validation failed
- `500` - Unexpected server error

### 4. **Deprecated Endpoint: `POST /auth/token-exchange`**

**Status:** HTTP 410 Gone

This endpoint is no longer used in the new orchestrator-mediated flow. Frontend should call `POST /iam/auth/callback` instead.

---

## Key Security Improvements

| Aspect | Before | After |
|--------|--------|-------|
| **Code Verifier** | Exposed to frontend | Server-side only ✅ |
| **PKCE** | Optional, frontend-generated | Mandatory, server-generated ✅ |
| **Token Exchange** | Frontend directly calls Keycloak | Orchestrator handles ✅ |
| **Token Validation** | Frontend basic parse only | Server validates all claims ✅ |
| **Nonce** | Passed to frontend | Server-side validation ✅ |
| **State** | Basic check | Validated with expiry ✅ |
| **CSRF Protection** | Minimal | State + nonce ✅ |
| **Token Integrity** | Not validated | Issuer + audience validated ✅ |

---

## Frontend Migration Guide

### Step 1: Update Login Flow

**Before:**
```javascript
// Frontend generates PKCE
const { codeVerifier, codeChallenge } = generatePKCE();
const response = await fetch('/iam/login/start', {
  method: 'POST',
  body: JSON.stringify({
    identifier: email,
    codeChallenge  // Frontend-generated
  })
});
const { authUrl } = await response.json();
window.location.href = authUrl;
```

**After:**
```javascript
// Orchestrator generates PKCE
const response = await fetch('/iam/login/start', {
  method: 'POST',
  body: JSON.stringify({
    identifier: email
    // NO codeChallenge - orchestrator handles it
  })
});
const { authUrl } = await response.json();
window.location.href = authUrl;
```

### Step 2: Update Callback Handler

**Before:**
```javascript
// /auth/callback page
const { code, state } = getUrlParams();
const { codeVerifier } = retrieveFromLocalStorage(); // Stored earlier
const response = await fetch('/auth/token-exchange', {
  method: 'POST',
  body: JSON.stringify({
    code,
    codeVerifier,  // Sent to backend
    redirectUri: window.location.origin + '/auth/callback'
  })
});
const tokens = await response.json();
```

**After:**
```javascript
// /auth/callback page
const { code, state } = getUrlParams();
const response = await fetch('/iam/auth/callback', {
  method: 'POST',
  body: JSON.stringify({
    code,
    state
    // NO codeVerifier - orchestrator uses stored one
  })
});
const sessionContext = await response.json();
const { user, tokens, roles } = sessionContext;
```

### Step 3: Update Storage

**Before:**
```javascript
// Store code_verifier in localStorage
localStorage.setItem('codeVerifier', codeVerifier);
localStorage.setItem('state', state);
```

**After:**
```javascript
// No need to store code_verifier anymore
localStorage.setItem('state', state);
// Optional: store nonce if doing extra validation
```

---

## Testing Scenarios

### Scenario 1: ACTIVE User Login
1. Frontend calls `POST /iam/login/start` with identifier
2. Backend generates PKCE, stores code_verifier server-side
3. Backend returns authUrl with code_challenge
4. Frontend redirects to Keycloak
5. User authenticates, Keycloak redirects with code+state
6. Frontend sends code+state to `POST /iam/auth/callback`
7. Backend exchanges code using stored code_verifier
8. Backend validates token claims
9. Backend returns session context

### Scenario 2: OTP Verification → Password Setup
1. Frontend calls `POST /iam/login/start` with identifier (new user)
2. Backend detects PASSWORD_PENDING status
3. Backend generates OTP, PKCE parameters
4. Frontend sends OTP to `POST /iam/activation/verify-otp`
5. Backend verifies OTP, creates Keycloak user, generates activation token
6. Backend stores code_verifier, generates authUrl
7. Frontend redirects to Keycloak with activation_token
8. Keycloak authenticator validates activation_token
9. User sets password
10. Keycloak redirects with code+state
11. Frontend sends code+state to `POST /iam/auth/callback`
12. Backend exchanges code using stored code_verifier
13. Backend validates tokens and updates migration status → ACTIVE
14. Backend returns session context

### Scenario 3: Cached Activation Response
1. User completes OTP verification, gets activation URL
2. Frontend loses connection or page refreshes
3. Frontend calls `POST /iam/login/start` again
4. Backend detects PASSWORD_SETUP_INITIATED status
5. Backend retrieves cached activation response from Redis (5-min TTL)
6. Backend returns same authUrl to frontend
7. User can continue from where they left off

---

## Rollback Plan

If issues arise, the old `/auth/token-exchange` endpoint is marked as deprecated but can be re-enabled by:

1. Removing the deprecation warning
2. Re-implementing token exchange logic to accept code_verifier from frontend
3. Updating frontend to pass code_verifier

However, this would lose the security benefits of server-side PKCE handling.

---

## Monitoring & Debugging

### Key Log Points Added

```javascript
[LOGIN] Generated PKCE and state for {identifier}
[OTP] Built activation authUrl for {identifier}
[CALLBACK] State validated for {identifier}
[CALLBACK] ID token validated for subject: {subject}
[CALLBACK] Access token validated
[CALLBACK] Keycloak user: subject={subject}, username={username}
[CALLBACK] Updated migration status to ACTIVE for {identifier}
[CALLBACK] Returning session context for {identifier}
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Invalid or expired state" | State expired or missing | Ensure callback happens within 10 minutes |
| "Invalid nonce" | Nonce mismatch | Check if authUrl was modified |
| "Invalid issuer" | Wrong Keycloak instance | Verify KEYCLOAK_URL configuration |
| "Invalid audience" | Token not for diksha-portal client | Verify client_id in Keycloak |
| Token exchange fails | Code already used or expired | Ensure code is used once within 10 minutes |

