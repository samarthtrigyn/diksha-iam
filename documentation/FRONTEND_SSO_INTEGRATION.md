# Frontend SSO Integration - Implementation Guide

## ✅ FRONTEND COMPLETE - May 10, 2026

SSO login buttons and callback handling have been fully integrated into the DIKSHA frontend.

---

## 📋 Files Modified

### 1. **LoginPage.jsx** - SSO Login Initiation
**Location**: `/frontend/src/pages/LoginPage.jsx`

**Changes**:
- Added `ORCHESTRATOR_URL` configuration (from env or default to localhost:4000)
- Added `handleGoogleLogin()` - Initiates Google OAuth flow
- Added `handleStateSsoLogin(stateCode)` - Initiates State SSO flow
- Updated social buttons to call handlers with proper state management

**Functions**:

```javascript
// Initiate Google SSO
const handleGoogleLogin = async () => {
  // 1. Call GET /iam/sso/google/login
  // 2. Store state in sessionStorage for callback validation
  // 3. Redirect user to Google OAuth consent screen
}

// Initiate State SSO (Meghalaya, Karnataka, etc.)
const handleStateSsoLogin = async (stateCode) => {
  // 1. Call GET /iam/sso/state_{stateCode}/login
  // 2. Store state in sessionStorage
  // 3. Redirect user to State SSO provider
}
```

**Social Button Configuration**:
- **Meghalayan**: `handleStateSsoLogin('meghalaya')`
- **State System**: `handleStateSsoLogin('state')`
- **Google**: `handleGoogleLogin()`
- **Apple**: Disabled (coming soon)

---

### 2. **CallbackPage.jsx** - SSO Callback Handler
**Location**: `/frontend/src/pages/CallbackPage.jsx`

**Changes**:
- Added dual-flow callback handling (Keycloak + SSO)
- Added `handleSsoCallback()` - Handles SSO provider callbacks
- Added `handleKeycloakCallback()` - Handles Keycloak callbacks
- Added conflict resolution UI for unverified email/phone
- Enhanced error handling and logging

**Flow**:

```javascript
// Detect callback type
const ssoProvider = sessionStorage.getItem('sso_provider');

if (ssoProvider) {
  // Handle SSO callback (Google, State SSO)
  await handleSsoCallback(ssoProvider, code, state);
} else {
  // Handle Keycloak callback (password + OTP flow)
  await handleKeycloakCallback(code, state);
}
```

**Response Handling**:
- **AUTHENTICATED**: Store tokens, navigate to dashboard
- **CONFLICT_RESOLUTION_REQUIRED**: Show conflict page with conflicting user list
- **Error**: Display error message, offer back-to-login button

**Conflict UI**:
```
Account Conflict - Resolve account linking
─────────────────────────────────────────
Cannot auto-link your email because it's already 
associated with an account.

Conflicting accounts:
  • user1 (john_doe_123)
  • user2 (jane_smith_456)

[Back to Login]
```

---

### 3. **api.js** - SSO Callback API Client
**Location**: `/frontend/src/utils/api.js`

**New Function**:

```javascript
/**
 * GET /iam/sso/:provider/callback
 * Handle SSO provider callback
 */
export async function postSsoCallback(provider, code, state) {
  // Calls GET /iam/sso/{provider}/callback?code=...&state=...
  // Returns: { flow, ssoAction, ssoProvider, user, tokens, conflict? }
}
```

---

## 🔄 SSO Login Flow - Step by Step

### User clicks "Login with Google"

```
1. LoginPage: handleGoogleLogin()
   ↓
2. API Call: GET /iam/sso/google/login
   ↓
3. Orchestrator generates state, PKCE, nonce
   Returns: { authUrl, state }
   ↓
4. Store state in sessionStorage
   sessionStorage.setItem('oauth_state', state)
   sessionStorage.setItem('sso_provider', 'google')
   ↓
5. Redirect to Google OAuth consent
   window.location.href = authUrl
   ↓
6. User authenticates with Google
   ↓
7. Google redirects to callback URL with code + state
   GET http://localhost:5173/auth/callback?code=...&state=...
   ↓
8. CallbackPage: handleCallback()
   ↓
9. Detect SSO callback (sso_provider in sessionStorage)
   ↓
10. API Call: GET /iam/sso/google/callback?code=...&state=...
   ↓
11. Orchestrator handles:
    - Validates state
    - Exchanges code for ID token
    - Calls User Service: POST /users/sso-resolve
    - Handles: EXISTING/LINKED/CREATED/CONFLICT
    ↓
12. Response: { flow, ssoAction, user, tokens, ... }
    ↓
13. If CONFLICT: Show conflict resolution page
    ↓
14. If AUTHENTICATED:
    - Store tokens in sessionStorage
    - Store user profile
    - Set Auth header
    - Navigate to /dashboard
```

---

## 📱 Session Storage Keys

After successful SSO authentication, these keys are set:

```javascript
sessionStorage.setItem('access_token', tokenData.accessToken);
sessionStorage.setItem('id_token', tokenData.idToken);
sessionStorage.setItem('refresh_token', tokenData.refreshToken);
sessionStorage.setItem('user_profile', JSON.stringify(result.user));
sessionStorage.setItem('token_decoded', JSON.stringify(result.user));
```

These match the format from Direct Grant (password) flow, so DashboardPage works with both flows.

---

## 🔐 Security Features

✅ **State Validation** - CSRF protection via state parameter
✅ **PKCE** - Authorization code flow with code challenge
✅ **Nonce** - Prevents token replay attacks
✅ **Secure Storage** - sessionStorage (not localStorage) for in-memory storage
✅ **Token Cleanup** - On logout, all SSO tokens cleared

---

## 🌍 Environment Variables

**Frontend (.env.local or .env)**:

```env
# Vite uses VITE_ prefix
VITE_ORCHESTRATOR_URL=http://localhost:4000
VITE_IAM_SERVICE_URL=http://localhost:3000

# Or use defaults (both fallback to localhost)
```

**Note**: Frontend uses `VITE_` prefix (Vite convention), while backend uses `REACT_APP_` (React convention - for reference in code comments).

---

## 🧪 Testing SSO Locally

### Prerequisites

1. Set Google OAuth credentials:
   ```bash
   # In .env or docker-compose
   GOOGLE_CLIENT_ID=<your-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<your-secret>
   ORCHESTRATOR_URL=http://localhost:4000
   ```

2. Start all services:
   ```bash
   docker-compose up
   ```

3. Open frontend:
   ```
   http://localhost:5173
   ```

### Test Scenarios

**Scenario 1: New User via Google**
- Action: Click "Login with Google"
- Expected: CREATED action
- Result: User created with ACTIVE status, dashboard shown

**Scenario 2: Existing User Logs In Again**
- Action: Click "Login with Google" with same Google account
- Expected: EXISTING action
- Result: User authenticated, dashboard shown

**Scenario 3: Verified Email Auto-Link**
- Action: Create password user with email "test@example.com"
- Action: Add Google account with same verified email
- Expected: LINKED action
- Result: Google account linked to password account, single Keycloak user

**Scenario 4: Unverified Email Conflict**
- Action: Create password user with email "test@example.com"
- Action: Try Google login with unverified email "test@example.com"
- Expected: CONFLICT action (409 response)
- Result: Conflict page shows with conflicting user list

---

## 📊 Component Architecture

```
LoginPage
├── Input fields (email/password)
├── Traditional login button
├── OTP login button
└── Social login buttons
    ├── Meghalayan (State SSO)
    ├── State System (State SSO)
    ├── Google
    └── Apple (disabled)

    ↓ (onClick)
    
handleGoogleLogin() / handleStateSsoLogin()
    ↓
Calls: GET /iam/sso/{provider}/login
    ↓
Returns: { authUrl, state }
    ↓
Redirects to: authUrl (Google/State SSO consent)
    ↓
User authenticates at provider
    ↓
Provider redirects to: /auth/callback?code=...&state=...
    ↓
CallbackPage
├── handleCallback()
└── Detect flow type
    ├── If sso_provider set:
    │   └── handleSsoCallback()
    │       ├── Call: GET /iam/sso/{provider}/callback
    │       ├── Handle: AUTHENTICATED / CONFLICT
    │       └── Store tokens or show conflict
    │
    └── Else:
        └── handleKeycloakCallback()
            ├── Call: POST /iam/auth/callback
            ├── Exchange code for tokens
            └── Store tokens
```

---

## 🐛 Debugging

### Enable Debug Logging

```javascript
// In browser console
localStorage.setItem('debug', 'diksha:*');
// Reload page to see [SSO] tagged logs
```

### Check Session Storage

```javascript
// In browser console
console.log('OAuth State:', sessionStorage.getItem('oauth_state'));
console.log('SSO Provider:', sessionStorage.getItem('sso_provider'));
console.log('Access Token:', sessionStorage.getItem('access_token')?.substring(0, 50) + '...');
```

### Common Issues

**Issue**: "OAuth_state is null"
- Cause: User didn't click SSO button
- Fix: Ensure button onClick calls handleGoogleLogin()

**Issue**: "sso_provider not found"
- Cause: CallbackPage called for traditional flow
- Fix: Check if user came from password/OTP login instead

**Issue**: "Invalid or expired state"
- Cause: User took > 10 min between login and callback
- Cause: State was used twice
- Fix: Start over with fresh login

**Issue**: "CONFLICT_RESOLUTION_REQUIRED"
- Cause: Unverified email/phone conflicts
- Fix: User needs to contact support for manual account linking

---

## 🚀 Next Steps

1. **Update LoginPage Styling**
   - Make social buttons more prominent
   - Add loading state animation
   - Show spinner while redirecting

2. **Implement Conflict Resolution**
   - Create ConflictResolutionPage component
   - Allow user to select which account to merge
   - Call POST /users/:id/link-external-identity

3. **Add Apple Sign-In** (Phase 4b)
   - Enable Apple button
   - Add AppleID OAuth configuration
   - Same flow as Google

4. **Improve Error Handling**
   - More detailed error messages
   - Retry buttons
   - Contact support links

5. **Analytics**
   - Track SSO success/failure rates
   - Monitor action distribution (EXISTING/LINKED/CREATED)
   - Analyze conflict resolution

---

## 📞 Quick Reference

| Component | Purpose | Key Function |
|-----------|---------|--------------|
| LoginPage | SSO initiation | handleGoogleLogin() |
| CallbackPage | Token exchange | handleSsoCallback() |
| api.js | HTTP client | postSsoCallback() |

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /iam/sso/google/login | GET | Get auth URL |
| /iam/sso/google/callback | GET | Exchange code |
| /iam/sso/state_*/login | GET | Get state SSO URL |
| /iam/sso/state_*/callback | GET | Exchange state code |
