# DIKSHA SSO - API Reference & Integration Guide

## 🎯 Implementation Complete - May 10, 2026

All SSO features (Google + State SSO) implemented across 3 services:
- ✅ iam-service: User resolution + external identity linking
- ✅ iam-orchestrator: OAuth2 login + callback endpoints
- ✅ Syntax verified: No errors

---

## 📋 Quick Start Checklist

- [ ] Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
- [ ] Update frontend to add SSO login buttons
- [ ] Add Postman collection for SSO endpoints (see API specs below)
- [ ] Test end-to-end flow
- [ ] Deploy to dev/staging

---

## 🔌 REST API Endpoints

### 1️⃣ Orchestrator: Initiate SSO Login

**Endpoint**: `GET /iam/sso/:provider/login`

**Provider**: `google` | `state_maharashtra` | `state_karnataka` | etc.

**Query Parameters** (optional):
- `redirectUri` - Custom redirect after SSO (defaults to env FRONTEND_REDIRECT_URI)

**Response** (200):
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...",
  "state": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example**:
```bash
GET http://localhost:4000/iam/sso/google/login
# Returns: { authUrl, state }
# Frontend redirects user to authUrl
```

**Response** (400):
```json
{
  "error": "Unsupported provider: invalid_provider"
}
```

---

### 2️⃣ Orchestrator: Handle OAuth Callback

**Endpoint**: `GET /iam/sso/:provider/callback`

**Query Parameters** (from OAuth provider):
- `code` - Authorization code (from provider)
- `state` - State token (sent in login step)
- `error` - Error from provider (if auth failed)

**Response** (200 - Success):
```json
{
  "flow": "AUTHENTICATED",
  "ssoAction": "EXISTING",
  "ssoProvider": "google",
  "user": {
    "id": "abc123def456",
    "username": "john_doe_123",
    "email": "john@example.com",
    "name": "John Doe",
    "iamUserId": "user-id-in-iam"
  },
  "tokens": {
    "accessToken": "eyJhbGc...",
    "idToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "expiresIn": 3600,
    "tokenType": "Bearer"
  },
  "activationStatus": "ACTIVE"
}
```

**Frontend Action**:
```javascript
// Store tokens in sessionStorage
sessionStorage.setItem('access_token', response.tokens.accessToken);
sessionStorage.setItem('id_token', response.tokens.idToken);
sessionStorage.setItem('token_decoded', JSON.stringify(response.user));
sessionStorage.setItem('user_profile', JSON.stringify(response.user));

// Navigate to dashboard
window.location.href = '/dashboard';
```

**Response** (409 - Conflict):
```json
{
  "flow": "CONFLICT_RESOLUTION_REQUIRED",
  "ssoProvider": "google",
  "conflict": {
    "reason": "unverified_email_conflict",
    "existingUserIds": ["id1", "id2"],
    "existingUsernames": ["user1", "user2"],
    "requestedEmail": "john@example.com",
    "message": "Cannot auto-link unverified email. User account exists with this email."
  }
}
```

**Response** (400 - Invalid State):
```json
{
  "error": "Invalid or expired state"
}
```

---

### 3️⃣ User Service: Resolve SSO User

**Endpoint**: `POST /iam/users/sso-resolve`

**Body**:
```json
{
  "provider": "google",
  "idtype": "sub",
  "externalid": "1234567890",
  "email": "john@example.com",
  "emailVerified": true,
  "phone": "9876543210",
  "phoneVerified": true,
  "firstname": "John",
  "lastname": "Doe"
}
```

**Response** (200 - Existing User):
```json
{
  "user": {
    "id": "user-uuid",
    "firstname": "John",
    "lastname": "Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "status": 1,
    "username": "john_doe_123"
  },
  "action": "EXISTING",
  "linkedVia": null
}
```

**Response** (200 - Linked to Existing Account):
```json
{
  "user": { ... },
  "action": "LINKED",
  "linkedVia": "email"
}
```

**Response** (201 - New User Created):
```json
{
  "user": { ... },
  "action": "CREATED",
  "linkedVia": null
}
```

**Response** (409 - Conflict):
```json
{
  "action": "CONFLICT",
  "conflict": {
    "reason": "unverified_email_conflict",
    "existingUserIds": ["id1"],
    "existingUsernames": ["user1"],
    "requestedEmail": "john@example.com",
    "message": "Cannot auto-link unverified email. User account exists with this email."
  }
}
```

---

### 4️⃣ User Service: Resolve by External ID

**Endpoint**: `GET /iam/users/external/:provider/:idtype/:externalid`

**Example**:
```bash
GET http://localhost:3000/users/external/google/sub/1234567890
```

**Response** (200):
```json
{
  "user": { ... },
  "action": "EXISTING"
}
```

**Response** (404):
```json
{
  "error": "User not found"
}
```

---

### 5️⃣ User Service: Link External Identity

**Endpoint**: `POST /iam/users/:id/link-external-identity`

**Params**:
- `id` - IAM user ID

**Body**:
```json
{
  "provider": "google",
  "idtype": "sub",
  "externalid": "1234567890"
}
```

**Response** (200):
```json
{
  "userId": "user-uuid",
  "linked": true,
  "externalIdentity": {
    "provider": "google",
    "idtype": "sub",
    "externalid": "1234567890"
  }
}
```

**Response** (409 - Already Linked):
```json
{
  "errorCode": 409,
  "error": "Conflict",
  "message": "External identity already linked to this user"
}
```

---

## 🔄 Supported SSO Actions

| Action | Scenario | User Status | Password Required |
|--------|----------|-------------|-------------------|
| **EXISTING** | Same Google ID login again | ACTIVE | No |
| **LINKED** | Verified email/phone matches existing account | ACTIVE | No |
| **CREATED** | New user from SSO (no conflicts) | ACTIVE | No |
| **CONFLICT** | Unverified email/phone exists → manual resolution | - | Manual merge |

---

## 🔐 Environment Variables

### Required (for Google SSO)
```env
GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```

### Optional (for State SSO)
```env
# Example: Maharashtra
STATE_MAHARASHTRA_CLIENT_ID=state-client-id
STATE_MAHARASHTRA_CLIENT_SECRET=state-client-secret
STATE_MAHARASHTRA_AUTH_ENDPOINT=https://sso.maharashtra.gov.in/authorize
STATE_MAHARASHTRA_TOKEN_ENDPOINT=https://sso.maharashtra.gov.in/token
STATE_MAHARASHTRA_SCOPES=openid email profile

# Add for each state as needed
```

### Optional (URLs)
```env
ORCHESTRATOR_URL=http://localhost:4000
FRONTEND_REDIRECT_URI=http://localhost:5173/auth/callback
```

---

## 📱 Frontend Integration Guide

### Step 1: Add SSO Login Button
```jsx
// LoginPage.jsx
function handleGoogleLogin() {
  const response = await fetch('http://localhost:4000/iam/sso/google/login');
  const { authUrl, state } = await response.json();
  
  sessionStorage.setItem('oauth_state', state);
  window.location.href = authUrl;
}

return (
  <button onClick={handleGoogleLogin}>
    Login with Google
  </button>
);
```

### Step 2: Handle Callback
```jsx
// CallbackPage.jsx - triggered after Google redirects back
useEffect(() => {
  const handleCallback = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    
    const response = await fetch(
      `http://localhost:4000/iam/sso/google/callback?code=${code}&state=${state}`
    );
    const data = await response.json();
    
    if (data.flow === 'CONFLICT_RESOLUTION_REQUIRED') {
      // Handle conflict - show manual merge page
      setConflict(data.conflict);
    } else if (data.flow === 'AUTHENTICATED') {
      // Store tokens (same format as Direct Grant)
      sessionStorage.setItem('access_token', data.tokens.accessToken);
      sessionStorage.setItem('token_decoded', JSON.stringify(data.user));
      sessionStorage.setItem('user_profile', JSON.stringify(data.user));
      
      // Navigate to dashboard
      navigate('/dashboard');
    }
  };
  
  handleCallback();
}, []);
```

---

## 🧪 Postman Collection

### Import into Postman

Create requests with these settings:

**1. Get Google SSO Login URL**
```
GET http://localhost:4000/iam/sso/google/login
```

**2. Simulate Google Callback** (after manually doing OAuth)
```
GET http://localhost:4000/iam/sso/google/callback?code={{code}}&state={{state}}
```

**3. Direct API Test: Resolve SSO User**
```
POST http://localhost:3000/users/sso-resolve
Content-Type: application/json

{
  "provider": "google",
  "idtype": "sub",
  "externalid": "1234567890",
  "email": "test@example.com",
  "emailVerified": true,
  "phone": "1234567890",
  "phoneVerified": true,
  "firstname": "Test",
  "lastname": "User"
}
```

---

## 🐛 Debugging

### Enable Verbose Logging
```env
DEBUG=diksha:*
```

### Check Logs
```bash
# Orchestrator
docker logs diksha-orchestrator

# User Service
docker logs diksha-user-service

# Look for [SSO] tagged logs
```

### Common Issues

**Issue**: "Unsupported provider"
- Fix: Ensure provider name is 'google' or 'state_*'

**Issue**: "Invalid or expired state"
- Fix: State expires in 10 minutes, user took too long
- Fix: State was used twice, user clicked login multiple times

**Issue**: "CONFLICT_RESOLUTION_REQUIRED"
- Cause: Unverified email/phone exists
- Solution: Show conflict page, let user manually merge

**Issue**: User gets stuck in PASSWORD_SETUP
- Cause: SSO user shouldn't need password
- Fix: Mapping should be set to ACTIVE immediately
- Check: mappingStore has activationStatus='ACTIVE'

---

## 📊 Data Flow Summary

```
User clicks "Login with Google"
    ↓
GET /iam/sso/google/login
    ↓
Generate state + PKCE, store in Redis
    ↓
Return authUrl to frontend
    ↓
Frontend redirects to Google auth
    ↓
User logs in at Google
    ↓
Google redirects back with code + state
    ↓
GET /iam/sso/google/callback?code=...&state=...
    ↓
Validate state, exchange code for ID token
    ↓
POST /iam/users/sso-resolve (with token claims)
    ↓
Check existing → EXISTING
     or auto-link verified email → LINKED
     or auto-link verified phone → LINKED
     or unverified email conflict → CONFLICT
     or create new user → CREATED
    ↓
Upsert Keycloak user
    ↓
Set mapping to ACTIVE
    ↓
Return session { user, tokens, activationStatus: ACTIVE }
    ↓
Frontend stores tokens in sessionStorage
    ↓
Navigate to Dashboard
```

---

## 🚀 Next Phase

**Future Enhancements**:
- [ ] Apple Sign-In (Phase 4b)
- [ ] Multi-state SSO configuration (UI)
- [ ] Account linking UI (for CONFLICT handling)
- [ ] Two-factor authentication for SSO
- [ ] SSO logout (revoke third-party access)

---

## 📞 Support

For issues or questions, check:
1. Session memory: `/memories/session/implementation-summary.md`
2. Code comments in SSO endpoints (marked with [SSO] logs)
3. Error responses (400/409/500 with detailed messages)
