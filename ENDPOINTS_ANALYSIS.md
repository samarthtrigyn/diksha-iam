# DIKSHA IAM - Complete API Endpoints Reference

## Overview
This document provides a comprehensive reference of all authentication, registration, OTP, and SSO endpoints across the DIKSHA IAM ecosystem.

---

## 1. IAM ORCHESTRATOR - AUTHENTICATION/REGISTRATION ROUTES

### Direct Grant (Password Grant) Login Flow
**File:** `iam-orchestrator/src/routes/auth/direct-grant/directGrant.js`

#### POST `/iam/auth/login/direct-grant`
- **Method:** POST
- **Purpose:** Resource Owner Password Credentials Grant (Direct Grant) - Direct username/email/phone + password login
- **Rate Limit:** Strict (20 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "identifier": "email@example.com OR +919999999999 OR username",
    "password": "required_for_non_first_time_users",
    "clientId": "diksha-portal OR diksha-mobile",
    "redirectUri": "optional",
    "channel": "WEB OR MOBILE (auto-detected if not provided)"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "userId": "uuid",
        "username": "string",
        "email": "string",
        "roles": ["role1", "role2"],
        "activationStatus": "ACTIVE"
      },
      "tokens": {
        "accessToken": "jwt",
        "idToken": "jwt",
        "refreshToken": "jwt",
        "expiresIn": 3600,
        "tokenType": "Bearer"
      },
      "sessionId": "uuid"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR user_not_found OR password_reset_required OR invalid_credentials OR user_inactive OR invalid_client OR server_error",
    "errorDescription": "Human readable message",
    "statusCode": 400/401/404/409/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing required parameters
  - `user_not_found` - Identifier not found
  - `password_reset_required` - First-time user must verify OTP and set password
  - `invalid_credentials` - Password incorrect
  - `user_inactive` - User account is inactive
  - `invalid_client` - Client not found/invalid
  - `server_error` - Internal server error
- **Implementation Notes:**
  - Supports email, phone (10-12 digits), or username as identifier
  - Validates against IAM Service first, then Keycloak
  - Creates session if successful
  - Sets secure cookie with sessionId
  - Enforces strict rate limiting

---

### Registration - Initialize
**File:** `iam-orchestrator/src/routes/auth/direct-grant/registerInit.js`

#### POST `/iam/auth/register/init`
- **Method:** POST
- **Purpose:** Initialize user registration (validate identifier, create transaction)
- **Rate Limit:** Strict (20 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "identifier": "email@example.com OR +919999999999"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "txnId": "uuid",
      "flow": "REGISTRATION",
      "maskedIdentifier": "ra***@example.com OR +91****9999",
      "message": "Registration initialized. Click 'Send OTP' to proceed."
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR invalid_identifier OR user_already_exists OR server_error",
    "errorDescription": "message",
    "statusCode": 400/409,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing identifier
  - `invalid_identifier` - Invalid email/phone format
  - `user_already_exists` - User already registered with this email/phone
  - `server_error` - Internal error
- **Implementation Notes:**
  - Validates email format (RFC standard)
  - Validates phone format (10-12 digits)
  - Checks user doesn't already exist via IAM Service
  - OTP is NOT sent in this step

---

### Registration - Send OTP
**File:** `iam-orchestrator/src/routes/auth/direct-grant/registerSendOtp.js`

#### POST `/iam/auth/register/send-otp`
- **Method:** POST
- **Purpose:** Send OTP to user's email/phone during registration
- **Rate Limit:** Very Strict (5 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "txnId": "uuid from /iam/auth/register/init"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "txnId": "uuid",
      "status": "OTP_SENT",
      "maskedIdentifier": "ra***@example.com",
      "resendAfterSeconds": 60,
      "message": "OTP sent successfully"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR invalid_transaction OR invalid_status OR otp_failed OR server_error",
    "errorDescription": "message",
    "statusCode": 400/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing txnId
  - `invalid_transaction` - Transaction not found or expired
  - `invalid_status` - Transaction status doesn't allow OTP sending
  - `otp_failed` - Failed to send OTP
  - `server_error` - Internal error
- **Implementation Notes:**
  - Calls OTP service via iam-core
  - Transaction TTL: 30 minutes
  - Resend cooldown: 60 seconds

---

### Registration - Verify OTP
**File:** `iam-orchestrator/src/routes/auth/direct-grant/registerVerifyOtp.js`

#### POST `/iam/auth/register/verify-otp`
- **Method:** POST
- **Purpose:** Verify OTP received during registration
- **Rate Limit:** Very Strict (5 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "txnId": "uuid from /iam/auth/register/init",
    "otp": "4-8 digits"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "txnId": "uuid",
      "flow": "REGISTRATION",
      "status": "OTP_VERIFIED",
      "message": "OTP verified successfully. Please proceed to set password."
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR invalid_otp OR otp_expired OR txn_not_found OR server_error",
    "errorDescription": "message",
    "statusCode": 400/404/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing txnId or otp
  - `invalid_otp` - OTP is incorrect
  - `otp_expired` - OTP verification attempts exceeded
  - `txn_not_found` - Transaction expired or invalid
  - `server_error` - Internal error
- **Implementation Notes:**
  - OTP format: 4-8 digits
  - Max 3 attempts before transaction expires
  - Transaction TTL: 30 minutes

---

### Registration - Complete
**File:** `iam-orchestrator/src/routes/auth/direct-grant/registerComplete.js`

#### POST `/iam/auth/register/complete`
- **Method:** POST
- **Purpose:** Complete registration by setting password and creating user account
- **Rate Limit:** Strict (20 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "txnId": "uuid from /iam/auth/register/verify-otp",
    "password": "min 8 chars: uppercase, lowercase, number, special char",
    "confirmPassword": "must match password",
    "termsAccepted": true
  }
  ```
- **Response Success (201):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "userId": "uuid",
        "username": "string",
        "email": "string",
        "status": "ACTIVE"
      },
      "message": "Registration completed successfully. Welcome to DIKSHA!"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR password_mismatch OR weak_password OR terms_not_accepted OR txn_not_found OR user_creation_failed OR server_error",
    "errorDescription": "message",
    "statusCode": 400/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing required fields
  - `password_mismatch` - Passwords don't match
  - `weak_password` - Password doesn't meet requirements
  - `terms_not_accepted` - Terms not accepted
  - `txn_not_found` - Transaction expired/invalid
  - `user_creation_failed` - Failed to create user
  - `server_error` - Internal error
- **Password Requirements:**
  - Minimum 8 characters
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one digit
  - At least one special character (@$!%*?&)
- **Implementation Notes:**
  - Creates user in both IAM Service and Keycloak
  - Sets user as ACTIVE
  - Cleans up transaction after completion

---

### Password Reset - Initialize
**File:** `iam-orchestrator/src/routes/auth/direct-grant/resetPasswordInit.js`

#### POST `/iam/auth/reset-password/init`
- **Method:** POST
- **Purpose:** Initialize password reset flow by sending OTP
- **Rate Limit:** Strict (20 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "identifier": "email@example.com OR +919999999999"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "txnId": "uuid",
      "flow": "PASSWORD_RESET",
      "maskedIdentifier": "ra***@example.com",
      "resendAfterSeconds": 60
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR invalid_identifier OR user_not_found OR otp_failed OR server_error",
    "errorDescription": "message",
    "statusCode": 400/404/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing identifier
  - `invalid_identifier` - Invalid email/phone format
  - `user_not_found` - User not registered
  - `otp_failed` - Failed to send OTP
  - `server_error` - Internal error
- **Implementation Notes:**
  - Transaction TTL: 30 minutes
  - OTP sent via OTP service (iam-core)

---

### Password Reset - Verify OTP
**File:** `iam-orchestrator/src/routes/auth/direct-grant/resetPasswordVerifyOtp.js`

#### POST `/iam/auth/reset-password/verify-otp`
- **Method:** POST
- **Purpose:** Verify OTP code during password reset
- **Rate Limit:** Very Strict (5 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "txnId": "uuid from /iam/auth/reset-password/init",
    "otp": "4-8 digits"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "txnId": "uuid",
      "flow": "PASSWORD_RESET",
      "status": "OTP_VERIFIED",
      "message": "OTP verified successfully. Proceed to set new password."
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR invalid_otp OR otp_expired OR txn_not_found OR server_error",
    "errorDescription": "message",
    "statusCode": 400/404/429/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing txnId or otp
  - `invalid_otp` - OTP is incorrect
  - `otp_expired` - OTP verification attempts exceeded
  - `txn_not_found` - Transaction expired or invalid
  - `invalid_txn_flow` - Invalid transaction flow
  - `invalid_state` - Transaction not in OTP_SENT state
  - `server_error` - Internal error
- **Implementation Notes:**
  - Max 3 OTP attempts
  - Ensures user exists in Keycloak (creates if missing)
  - Transaction TTL: 30 minutes

---

### Password Reset - Complete
**File:** `iam-orchestrator/src/routes/auth/direct-grant/resetPasswordComplete.js`

#### POST `/iam/auth/reset-password/complete`
- **Method:** POST
- **Purpose:** Complete password reset by setting new password
- **Rate Limit:** Strict (20 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "txnId": "uuid from /iam/auth/reset-password/verify-otp",
    "password": "min 8 chars: uppercase, lowercase, number, special char",
    "confirmPassword": "must match password"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Your password has been reset successfully. Please login with your new password"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR password_mismatch OR weak_password OR txn_not_found OR txn_expired OR invalid_state OR password_reset_failed OR user_not_found OR server_error",
    "errorDescription": "message",
    "statusCode": 400/404/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `invalid_request` - Missing required fields
  - `password_mismatch` - Passwords don't match
  - `weak_password` - Password doesn't meet requirements
  - `txn_not_found` - Transaction not found
  - `txn_expired` - Transaction expired
  - `invalid_state` - OTP not verified yet
  - `invalid_txn_flow` - Invalid transaction flow
  - `user_not_found` - User not found in Keycloak
  - `password_reset_failed` - Failed to reset password
  - `server_error` - Internal error
- **Implementation Notes:**
  - Requires OTP_VERIFIED state
  - Updates password in Keycloak
  - Cleans up transaction after completion

---

### Token Refresh
**File:** `iam-orchestrator/src/routes/auth/refresh.js`

#### POST `/iam/auth/refresh`
- **Method:** POST
- **Purpose:** Refresh access token using refresh token
- **Rate Limit:** Global (100 requests/15 minutes)
- **Request Body:**
  ```json
  {
    "clientId": "optional - Client ID for validation",
    "refreshToken": "optional - Explicit refresh token (if not using cookie)"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "new jwt",
      "idToken": "new jwt",
      "refreshToken": "new or same jwt",
      "expiresIn": 1800,
      "tokenType": "Bearer",
      "sessionId": "uuid if session-based"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "unauthorized OR invalid_grant OR server_error",
    "errorDescription": "message",
    "statusCode": 401/500,
    "timestamp": "ISO8601"
  }
  ```
- **Error Codes:**
  - `unauthorized` - No session or refresh token provided
  - `invalid_grant` - Token refresh failed
  - `server_error` - Internal error
- **Implementation Notes:**
  - Supports cookie-based sessions (preferred)
  - Supports explicit refresh token
  - Auto-detects client type (portal vs mobile)
  - Rotates session if using cookie-based auth

---

## 2. IAM ORCHESTRATOR - SSO ROUTES

**File:** `iam-orchestrator/src/routes/sso.js`

### SSO Login Initiate
#### GET `/iam/sso/:provider/login`
- **Method:** GET
- **Purpose:** Initiate SSO login with external provider
- **Supported Providers:** `google`, `kc-google-broker`, `state_*` (custom state SSO providers)
- **Query Parameters:**
  ```
  ?redirectUri=optional_frontend_url
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
      "state": "uuid"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - **Google Direct:** Uses Google OAuth2 directly (client credentials)
  - **Keycloak-Brokered Google:** Uses Keycloak as IdP broker with PKCE flow
  - **Custom State Providers:** Uses configured state-based SSO endpoints
  - State expires in 10 minutes
  - PKCE used for Keycloak-brokered flows

---

### SSO Callback
#### GET `/iam/sso/:provider/callback`
- **Method:** GET
- **Purpose:** Handle SSO provider callback after user authorization
- **Query Parameters:**
  ```
  ?code=authorization_code&state=uuid&error=optional_error
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "userId": "uuid",
        "username": "string",
        "email": "string",
        "roles": [],
        "activationStatus": "ACTIVE OR PASSWORD_SETUP_REQUIRED"
      },
      "tokens": {
        "accessToken": "jwt",
        "idToken": "jwt",
        "refreshToken": "jwt or null",
        "expiresIn": 3600,
        "tokenType": "Bearer"
      },
      "sessionId": "uuid",
      "action": "EXISTING OR CREATED"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "provider_error OR invalid_state OR token_validation_failed OR conflict OR server_error",
    "errorDescription": "message",
    "statusCode": 400/409/500,
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - Validates state from stateStore
  - Exchanges authorization code for ID/access tokens
  - Validates token signatures and claims
  - Resolves/creates user in IAM Service
  - Links external identity
  - Handles conflicts (same email linked to multiple accounts)
  - Creates session and sets secure cookie

---

## 3. IAM ORCHESTRATOR - USER & SESSION ROUTES

### Get Current User
**File:** `iam-orchestrator/src/routes/me.js`

#### GET `/iam/users/me` (or `/iam/me`)
- **Method:** GET
- **Purpose:** Get authenticated user profile and session details
- **Authentication:** Cookie (sessionId) OR Bearer token
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "userId": "uuid",
      "username": "string",
      "email": "string",
      "name": "string",
      "roles": ["role1", "role2"],
      "loginProvider": "KEYCLOAK OR EXTERNAL_PROVIDER",
      "activationStatus": "ACTIVE",
      "org": {
        "orgId": "uuid or null",
        "orgName": "string or null"
      },
      "externalIdentities": {
        "provider": "external_id"
      }
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx):**
  ```json
  {
    "success": false,
    "error": "unauthorized OR invalid_token OR server_error",
    "errorDescription": "message",
    "statusCode": 401/500,
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - Supports both session cookie and Bearer token authentication
  - Enriches user data from mappingStore
  - Returns external identities if user linked via SSO

---

### Logout
**File:** `iam-orchestrator/src/routes/logout.js`

#### POST `/iam/auth/logout` (or `/iam/logout`)
- **Method:** POST
- **Purpose:** Revoke tokens and clear user session
- **Authentication:** Optional (can logout with or without tokens)
- **Request Body:**
  ```json
  {
    "clientId": "optional - Client ID",
    "refreshToken": "optional - Explicit refresh token",
    "logoutAllDevices": false
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Logout successful"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx/5xx):**
  ```json
  {
    "success": false,
    "error": "server_error",
    "errorDescription": "message",
    "statusCode": 500,
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - Revokes refresh token with Keycloak (best-effort)
  - Deletes application session
  - Clears secure cookie
  - `logoutAllDevices` attempts to revoke all active sessions (best-effort)
  - Continues even if token revocation fails

---

### Resolve User
**File:** `iam-orchestrator/src/routes/users/resolve.js`

#### POST `/iam/users/resolve`
- **Method:** POST
- **Purpose:** Resolve login identifier to user metadata
- **Request Body:**
  ```json
  {
    "identifier": "email@example.com OR +919999999999 OR username"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "iamUserId": "uuid",
      "username": "string",
      "email": "string",
      "phone": "string or null",
      "activationStatus": "ACTIVE OR PASSWORD_SETUP_REQUIRED OR null"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Response Error (4xx):**
  ```json
  {
    "success": false,
    "error": "invalid_request OR user_not_found OR server_error",
    "errorDescription": "message",
    "statusCode": 400/404/500,
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - Resolves email, phone, or username
  - Returns activation status from mappingStore
  - Used for pre-login validation
  - Helpful for debugging login issues

---

### Health Check
**File:** `iam-orchestrator/src/routes/health.js`

#### GET `/health`
- **Method:** GET
- **Purpose:** Health check endpoint
- **Response Success (200):**
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "service": "iam-orchestrator"
    },
    "timestamp": "ISO8601"
  }
  ```
- **Implementation Notes:**
  - No authentication required
  - Used for load balancer health checks

---

## 4. IAM ORCHESTRATOR - DEPRECATED/DISABLED ROUTES

**File:** `iam-orchestrator/src/routes/auth/direct-grant/legacyCodeGrantDisabled.js`

These endpoints return **HTTP 410 Gone** with error code `flow_deprecated`:

```
HTTP/1.1 410 Gone

{
  "success": false,
  "error": "flow_deprecated",
  "errorDescription": "Authorization code login flow is disabled. Use /iam/auth/login or /iam/auth/login/direct-grant with direct-grant APIs only.",
  "statusCode": 410,
  "timestamp": "ISO8601"
}
```

### Disabled Endpoints:

1. **POST** `/iam/auth/login/init` - Old authorization code flow init
2. **POST** `/iam/auth/otp/verify` - Old OTP verification
3. **GET** `/iam/oauth2/authorize` - Old OAuth2 authorize endpoint
4. **POST** `/iam/auth/session/exchange` - Old session exchange
5. **POST** `/iam/auth/login/password` - Old password login
6. **GET** `/iam/auth/callback` - Old authorization callback

---

## 5. IAM CORE - OTP SERVICE ROUTES (NON-MOCKED)

**File:** `iam-core/src/routes/otp.routes.js`

All OTP endpoints in iam-core are **non-mocked** and call the actual internal OTP service (learner/otp/v1/*)

### Generate OTP
#### POST `/otp/generate`
- **Method:** POST
- **Purpose:** Generate and send OTP to user's email or phone
- **Request Body:**
  ```json
  {
    "request": {
      "key": "user_email@example.com OR user_phone_number",
      "type": "email OR phone OR prevUsedEmail OR prevUsedPhone OR recoveryEmail OR recoveryPhone",
      "userId": "optional - user id",
      "templateId": "optional - resetPasswordWithOtp OR wardLoginOTP OR otpContactUpdateTemplate OR deleteUserAccountTemplate OR numeric id"
    }
  }
  ```
- **Response Success (200):**
  ```json
  {
    "id": "optional - request id",
    "ver": "optional - version",
    "ts": "ISO8601 timestamp",
    "params": { ... },
    "responseCode": "OK",
    "result": {
      "message": "OTP sent successfully",
      "key": "user email/phone"
    }
  }
  ```
- **Response Error (4xx/5xx):**
  - Encrypted error response (decrypted by client)
- **Implementation Notes:**
  - Calls actual internal OTP service (NOT mocked)
  - Uses HTTPS for security
  - Supports encrypted payload transmission
  - Timeout: 10 seconds (configurable via OTP_REQUEST_TIMEOUT_MS)
  - Allowed types: email, phone, prevUsedEmail, prevUsedPhone, recoveryEmail, recoveryPhone
  - Allowed templates: resetPasswordWithOtp, wardLoginOTP, otpContactUpdateTemplate, deleteUserAccountTemplate, or numeric template IDs

---

### Verify OTP
#### POST `/otp/verify`
- **Method:** POST
- **Purpose:** Verify OTP code
- **Request Body:**
  ```json
  {
    "request": {
      "key": "user_email@example.com OR user_phone_number",
      "type": "email OR phone OR prevUsedEmail OR prevUsedPhone OR recoveryEmail OR recoveryPhone",
      "otp": "otp_code",
      "userId": "optional - user id"
    }
  }
  ```
- **Response Success (200):**
  ```json
  {
    "id": "optional - request id",
    "ver": "optional - version",
    "ts": "ISO8601 timestamp",
    "params": { ... },
    "responseCode": "OK",
    "result": {
      "message": "OTP verified successfully",
      "valid": true
    }
  }
  ```
- **Response Error (4xx/5xx):**
  - Encrypted error response
- **Implementation Notes:**
  - Calls actual internal OTP service (NOT mocked)
  - Uses HTTPS for security
  - Validates OTP against stored value
  - Timeout: 10 seconds (configurable)
  - Allowed types: email, phone, prevUsedEmail, prevUsedPhone, recoveryEmail, recoveryPhone

---

## 6. IAM CORE - USERS SERVICE ROUTES

**File:** `iam-core/src/routes/users.routes.js`

### Create User
#### POST `/users`
- **Method:** POST
- **Purpose:** Create new user in IAM Service
- **Request Body:**
  ```json
  {
    "username": "string",
    "email": "string",
    "phone": "string optional",
    "firstName": "string optional",
    "lastName": "string optional",
    "externalIdentities": {
      "provider": "external_id"
    }
  }
  ```
- **Response Success (201):**
  ```json
  {
    "id": "uuid",
    "username": "string",
    "email": "string",
    "phone": "string optional",
    "firstName": "string optional",
    "lastName": "string optional",
    "externalIdentities": { ... }
  }
  ```

---

### Get User
#### GET `/users/:id`
- **Method:** GET
- **Purpose:** Get user by ID
- **Response Success (200):** User object (as above)

#### GET `/users?identifier=email_or_phone`
- **Method:** GET
- **Purpose:** Get user by email or phone
- **Query Parameters:** `?identifier=value`
- **Response Success (200):** User object

---

### Update User
#### PATCH `/users/:id`
- **Method:** PATCH
- **Purpose:** Update user fields
- **Request Body:** Partial user object with fields to update
- **Response Success (200):** Updated user object

---

### Delete User
#### DELETE `/users/:id`
- **Method:** DELETE
- **Purpose:** Delete user account
- **Response Success (200):**
  ```json
  {
    "message": "User deleted successfully",
    "id": "uuid"
  }
  ```

---

### Resolve User by External Identity
#### GET `/users/external/:provider/:idtype/:externalid`
- **Method:** GET
- **Purpose:** Find user by external identity (email/phone linked via SSO)
- **Path Parameters:**
  - `provider` - SSO provider (e.g., google, microsoft)
  - `idtype` - email or phone
  - `externalid` - external identifier value
- **Response Success (200):**
  ```json
  {
    "user": { ... },
    "action": "EXISTING"
  }
  ```
- **Response Error (404):**
  ```json
  {
    "error": "User not found"
  }
  ```

---

### SSO Resolve (Create or Link)
#### POST `/users/sso-resolve`
- **Method:** POST
- **Purpose:** Resolve SSO user (create if new, link if existing via other identity)
- **Request Body:**
  ```json
  {
    "provider": "google",
    "email": "user@example.com",
    "externalId": "google_user_id",
    "profile": {
      "name": "User Name",
      "picture": "url"
    }
  }
  ```
- **Response Success (200/201):**
  ```json
  {
    "user": { ... },
    "action": "EXISTING OR CREATED",
    "linkedVia": "email OR phone OR null"
  }
  ```
- **Response Error (409):**
  ```json
  {
    "error": "User conflict - email linked to another account",
    "action": "CONFLICT",
    "conflicts": [ ... ]
  }
  ```

---

### Link External Identity
#### POST `/users/:id/link-external-identity`
- **Method:** POST
- **Purpose:** Link SSO identity to existing user account
- **Request Body:**
  ```json
  {
    "provider": "google",
    "externalId": "google_user_id",
    "email": "user@example.com",
    "idtype": "email"
  }
  ```
- **Response Success (200):**
  ```json
  {
    "userId": "uuid",
    "linked": true,
    "externalIdentity": { ... }
  }
  ```

---

## 7. IAM CORE - SSO SERVICE ROUTES

**File:** `iam-core/src/routes/sso.routes.js`

### Get SSO URL
#### GET `/sso`
- **Method:** GET
- **Purpose:** Get SSO provider URLs (for frontend configuration)
- **Response Success (200):**
  ```json
  {
    "providers": {
      "google": "https://accounts.google.com/...",
      ...
    }
  }
  ```

---

## 8. KEYCLOAK INTEGRATION ENDPOINTS

### Keycloak Admin API (via services/keycloak.js)
**Base URL:** `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}`

These are called internally, not exposed as public APIs:

#### Get Admin Token
```
POST /auth/realms/master/protocol/openid-connect/token
- grant_type: client_credentials
- client_id: keycloak admin client
- client_secret: admin client secret
```

#### Get User by ID
```
GET /auth/admin/realms/{realm}/users/{userId}
- Authorization: Bearer {adminToken}
```

#### Create User
```
POST /auth/admin/realms/{realm}/users
- Authorization: Bearer {adminToken}
- Body: { username, email, enabled, ... }
```

#### Set User Password
```
PUT /auth/admin/realms/{realm}/users/{userId}/reset-password
- Authorization: Bearer {adminToken}
- Body: { type: "password", value, temporary }
```

#### Refresh Token
```
POST /auth/realms/{realm}/protocol/openid-connect/token
- grant_type: refresh_token
- refresh_token: {token}
- client_id: {clientId}
```

#### Revoke Token
```
POST /auth/realms/{realm}/protocol/openid-connect/revoke
- token: {refreshToken}
- client_id: {clientId}
- [client_secret: {secret}]
```

#### Direct Grant (Password Grant)
```
POST /auth/realms/{realm}/protocol/openid-connect/token
- grant_type: password
- username: {username}
- password: {password}
- client_id: {clientId}
```

---

## RATE LIMITING SUMMARY

| Endpoint Category | Rate Limit | Details |
|---|---|---|
| Health, Me, Logout | Global | 100 requests/15 minutes per IP |
| Direct Grant Login | Strict | 20 requests/15 minutes per IP |
| Register Init | Strict | 20 requests/15 minutes per IP |
| Register Send OTP | Very Strict | 5 requests/15 minutes per IP |
| Register Verify OTP | Very Strict | 5 requests/15 minutes per IP |
| Register Complete | Strict | 20 requests/15 minutes per IP |
| Reset Password Init | Strict | 20 requests/15 minutes per IP |
| Reset Password Verify OTP | Very Strict | 5 requests/15 minutes per IP |
| Reset Password Complete | Strict | 20 requests/15 minutes per IP |
| Password Setup Init | Very Strict | 5 requests/15 minutes per IP |
| Password Setup Complete | Very Strict | 5 requests/15 minutes per IP |
| Token Refresh | Global | 100 requests/15 minutes per IP |

---

## AUTHENTICATION METHODS

### 1. Session Cookie
- Cookie Name: `SESSION_COOKIE_NAME` (configured)
- Contains: `sessionId`
- Secure: HttpOnly, Secure flag set
- Used in: /iam/users/me, /iam/auth/logout (preferred)

### 2. Bearer Token (Authorization Header)
- Format: `Authorization: Bearer {accessToken}`
- Token Type: JWT (signed by Keycloak)
- Used in: /iam/users/me, optional in refresh

### 3. Refresh Token (Explicit)
- Passed in: Request body or cookie
- Used in: /iam/auth/refresh

---

## ERROR RESPONSE FORMAT

All errors follow consistent format:

```json
{
  "success": false,
  "error": "error_code",
  "errorDescription": "Human-readable message",
  "statusCode": 400,
  "timestamp": "ISO8601"
}
```

### Common HTTP Status Codes
- **200** - OK
- **201** - Created
- **400** - Bad Request (invalid parameters)
- **401** - Unauthorized (authentication failed)
- **404** - Not Found
- **409** - Conflict (user already exists)
- **410** - Gone (endpoint deprecated)
- **429** - Too Many Requests (rate limit exceeded)
- **500** - Internal Server Error

---

## CONFIGURATION VARIABLES

Key environment variables used:

```
# Keycloak
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_PUBLIC_URL=https://keycloak-public.example.com
KEYCLOAK_REALM=diksha
KEYCLOAK_PORTAL_CLIENT_ID=diksha-portal
KEYCLOAK_MOBILE_CLIENT_ID=diksha-mobile

# Orchestrator
ORCHESTRATOR_URL=https://orchestrator.example.com
FRONTEND_REDIRECT_URI=https://app.example.com/login/callback
SESSION_TTL=3600 (seconds)

# IAM Core / OTP
INTERNAL_API_BASE_URL=https://internal-api.example.com
OTP_REQUEST_TIMEOUT_MS=10000

# OAuth2 / SSO
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Feature Flags
USE_MOCK_OTP=false
MOCK_OTP_CODE=123456 (only if USE_MOCK_OTP=true)
```

---

## TRANSACTION FLOW DIAGRAM

```
Registration Flow:
1. POST /iam/auth/register/init → txnId
2. POST /iam/auth/register/send-otp (txnId) → OTP sent
3. POST /iam/auth/register/verify-otp (txnId, otp) → OTP verified
4. POST /iam/auth/register/complete (txnId, password) → User created

Password Reset Flow:
1. POST /iam/auth/reset-password/init (identifier) → txnId
2. POST /iam/auth/reset-password/verify-otp (txnId, otp) → OTP verified
3. POST /iam/auth/reset-password/complete (txnId, password) → Password reset

Direct Login Flow:
1. POST /iam/auth/login/direct-grant (identifier, password) → Tokens + Session

SSO Flow:
1. GET /iam/sso/:provider/login → authUrl
2. User authorizes at provider
3. Provider redirects to /iam/sso/:provider/callback
4. Orchestrator exchanges code for tokens
5. User created/resolved in IAM Service
6. Tokens + Session returned
```

---

## NOTES

- All timestamps are in ISO8601 format (UTC)
- All UUIDs are v4
- Session IDs are stored in Redis (via sessionStore)
- Transaction IDs are stored in Redis (via txnStore) with TTL of 30 minutes
- OTP verification has max 3 attempts per transaction
- Password requirements: min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char (@$!%*?&)
- All endpoints support CORS (configurable origins)
- All sensitive endpoints have rate limiting
- All endpoints log to console with [FLOW-NAME] prefix for debugging
