# DIKSHA IAM - Complete Login Flows Documentation

## Overview

After PKCE removal, the system now uses **Direct Grant (Password) Flow** for all authentication scenarios. This document details the three main login flow patterns.

---

## Flow 1: NEW USER REGISTRATION + LOGIN

**Scenario**: User doesn't exist in the system, needs to create account first, then login.

### API Call Sequence:

```
1. POST /iam/auth/register/init
   ↓
2. POST /iam/auth/register/send-otp
   ↓
3. POST /iam/auth/register/verify-otp
   ↓
4. POST /iam/auth/register/complete
   ↓
5. POST /iam/auth/login/direct-grant (SUCCESS - User now active)
```

### Step 1: Initialize Registration

**Endpoint**: `POST /iam/auth/register/init`

```json
Request:
{
  "identifier": "newuser@diksha.local"
}

Response (200 OK):
{
  "success": true,
  "data": {
    "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619",
    "flow": "REGISTRATION",
    "nextStep": "SEND_OTP",
    "maskedIdentifier": "ne***@diksha.local",
    "message": "Registration initialized. Click \"Send OTP\" to proceed."
  },
  "timestamp": "2026-05-26T09:37:14.114Z"
}
```

**Response Fields**:
- `txnId`: Transaction ID for tracking this registration attempt (used in all subsequent steps)
- `flow`: Always "REGISTRATION" for registration flows
- `nextStep`: Indicates the next expected client action
- `maskedIdentifier`: Partially masked email/phone for security
- `message`: User-friendly message

---

### Step 2: Send OTP

**Endpoint**: `POST /iam/auth/register/send-otp`

```json
Request:
{
  "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619"
}

Response (200 OK):
{
  "success": true,
  "data": {
    "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619",
    "status": "OTP_SENT",
    "nextStep": "VERIFY_OTP",
    "maskedIdentifier": "ne***@diksha.local",
    "resendAfterSeconds": 60,
    "message": "OTP sent successfully. Please verify to continue."
  },
  "timestamp": "2026-05-26T09:37:23.170Z"
}
```

**Response Fields**:
- `status`: "OTP_SENT" indicates OTP delivery was successful
- `resendAfterSeconds`: How long to wait before allowing OTP resend
- Mock OTP Code (for development): `123456`

---

### Step 3: Verify OTP

**Endpoint**: `POST /iam/auth/register/verify-otp`

```json
Request:
{
  "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619",
  "otp": "123456"
}

Response (200 OK):
{
  "success": true,
  "data": {
    "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619",
    "flow": "REGISTRATION",
    "status": "OTP_VERIFIED",
    "nextStep": "SET_PASSWORD",
    "message": "OTP verified successfully. Please proceed to set password."
  },
  "timestamp": "2026-05-26T09:37:33.778Z"
}
```

**Response Fields**:
- `status`: "OTP_VERIFIED" confirms OTP validation passed
- Only 3 OTP attempts allowed per transaction
- OTP TTL: 30 minutes

---

### Step 4: Complete Registration (Create Account)

**Endpoint**: `POST /iam/auth/register/complete`

```json
Request:
{
  "txnId": "51f35829-2a18-4a13-b643-4d05a9d2c619",
  "password": "NewPass@123456",
  "confirmPassword": "NewPass@123456",
  "termsAccepted": true
}

Response (201 Created):
{
  "success": true,
  "data": {
    "user": {
      "userId": "b8273bd8-7868-47a4-b7fa-a8eb391fd295",
      "username": "dikshauser_4col",
      "email": "newuser_1779788457950@diksha.local",
      "status": "ACTIVE"
    },
    "nextStep": "LOGIN",
    "message": "Registration completed successfully. Welcome to DIKSHA!"
  },
  "timestamp": "2026-05-26T09:37:43.749Z"
}
```

**Response Fields**:
- `user.userId`: Unique identifier in both IAM DB and Keycloak
- `user.username`: Auto-generated username
- `user.email`: Unencrypted email (synced to Keycloak)
- `user.status`: "ACTIVE" means user is ready to login
- HTTP 201 indicates resource (user) was created

**Backend Operations**:
1. Create user in IAM database with encrypted email/phone
2. Create user in Keycloak with unencrypted email
3. Set password in Keycloak
4. Create session in Redis

---

### Step 5: Login (Direct Grant)

**Endpoint**: `POST /iam/auth/login/direct-grant`

```json
Request:
{
  "identifier": "newuser_1779788457950@diksha.local",
  "password": "NewPass@123456",
  "clientId": "diksha-portal"
}

Response (200 OK):
{
  "success": true,
  "data": {
    "user": {
      "userId": "b8273bd8-7868-47a4-b7fa-a8eb391fd295",
      "username": "dikshauser_4col",
      "email": "newuser_1779788457950@diksha.local",
      "name": "DIKSHA User",
      "roles": [],
      "activationStatus": "ACTIVE"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAi...",
      "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAi...",
      "refreshToken": "eyJhbGciOiJIUzUxMiIsInR5cCIgOiAi...",
      "expiresIn": 300,
      "tokenType": "Bearer"
    },
    "sessionId": "a2e3a20b-f5dc-4ec7-aac2-4563b962fc7a"
  },
  "timestamp": "2026-05-26T09:37:53.216Z"
}
```

---

## Flow 2: EXISTING ACTIVE USER LOGIN

**Scenario**: User already exists in the system and is active. Direct login with credentials.

### API Call Sequence:

```
1. POST /iam/auth/login/direct-grant (SINGLE STEP)
   ↓
   SUCCESS - User receives tokens and session
```

### Step 1: Direct Grant Login

**Endpoint**: `POST /iam/auth/login/direct-grant`

```json
Request:
{
  "identifier": "testuser@diksha.local",
  "password": "Test@123456",
  "clientId": "diksha-portal"
}

Response (200 OK):
{
  "success": true,
  "data": {
    "user": {
      "userId": "3c676ee4-08fb-4b77-a099-6f621336c667",
      "username": "dikshauser_bifk",
      "email": "testuser@diksha.local",
      "name": "DIKSHA User",
      "roles": [],
      "activationStatus": "ACTIVE"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAi...",
      "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAi...",
      "refreshToken": "eyJhbGciOiJIUzUxMiIsInR5cCIgOiAi...",
      "expiresIn": 300,
      "tokenType": "Bearer"
    },
    "sessionId": "e77f699d-25f4-482b-b47e-255673ca2e53"
  },
  "timestamp": "2026-05-26T09:40:34.748Z"
}
```

**Backend Operations**:
1. Resolve user by identifier (email/phone/username) from IAM database
2. Check if user is ACTIVE
3. Exchange credentials with Keycloak using Direct Grant flow
4. Receive JWT tokens from Keycloak
5. Create session in Redis
6. Return tokens + sessionId + user info

**Token Details**:
- `accessToken`: JWT token for API requests (300s TTL = 5 minutes)
- `idToken`: JWT token containing user identity claims
- `refreshToken`: JWT token for refreshing expired accessToken (1 hour TTL)
- `expiresIn`: 300 seconds
- `tokenType`: "Bearer" (use in Authorization header)

**Session Details**:
- `sessionId`: Unique session identifier stored in Redis
- Cookie: Secure httpOnly cookie set with sessionId
- TTL: 1 hour

---

## Flow 3: FIRST-TIME USER (REGISTRATION + LOGIN)

**Scenario**: User registers, becomes active, and immediately logs in. Same as Flow 1 (New User).

### API Call Sequence:

```
Same as Flow 1 (5 steps):
1. POST /iam/auth/register/init
   ↓
2. POST /iam/auth/register/send-otp
   ↓
3. POST /iam/auth/register/verify-otp
   ↓
4. POST /iam/auth/register/complete
   ↓
5. POST /iam/auth/login/direct-grant (SUCCESS)
```

**Note**: The difference between Flow 1 and Flow 3 is semantic - they use identical API sequences. Flow 1 is for new users discovering the app, Flow 3 emphasizes their first-time nature.

---

## Unified Response Structure

### All Registration Endpoints (200 OK or 201 Created)

```json
{
  "success": true/false,
  "data": {
    // Endpoint-specific fields
    "txnId": "...",
    "flow": "...",
    "status": "...",
    "nextStep": "...",
    "message": "...",
    // Additional fields per endpoint
  },
  "timestamp": "ISO-8601"
}
```

**Fields Present in All Responses**:
- `success`: Boolean indicating success
- `timestamp`: ISO-8601 timestamp

---

### All Login Endpoints (200 OK)

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "UUID",
      "username": "string",
      "email": "string",
      "name": "string",
      "roles": ["array"],
      "activationStatus": "ACTIVE|INACTIVE"
    },
    "tokens": {
      "accessToken": "JWT string",
      "idToken": "JWT string",
      "refreshToken": "JWT string",
      "expiresIn": 300,
      "tokenType": "Bearer"
    },
    "sessionId": "UUID"
  },
  "timestamp": "ISO-8601"
}
```

---

## Summary Comparison Table

| Aspect | Flow 1: New User | Flow 2: Active User | Flow 3: First-Time |
|--------|-----------------|-------------------|-----------------|
| **Steps** | 5 (Register + Login) | 1 (Direct Login) | 5 (Register + Login) |
| **Registration Required** | Yes | No | Yes |
| **OTP Verification** | Yes | No | Yes |
| **Result** | Active user + tokens | Active user + tokens | Active user + tokens |
| **Time** | ~3-5 minutes | ~2 seconds | ~3-5 minutes |

---

## Response Structure Standardization

✅ **Standardized Fields Across All Endpoints**:
- `success`: Always present, indicates operation result
- `timestamp`: Always present, ISO-8601 format
- `data`: Always present, contains response payload
- `message`: User-friendly message in most responses
- `nextStep`: Indicates frontend's next expected action

✅ **Consistent Nested Structures**:
- User object: Always contains userId, username, email, status
- Tokens object: Always contains accessToken, idToken, refreshToken, expiresIn, tokenType
- Session: Always includes sessionId

✅ **HTTP Status Codes**:
- `200 OK`: Successful operation (login, verify, etc.)
- `201 Created`: User creation successful
- `400 Bad Request`: Invalid parameters or validation failure
- `401 Unauthorized`: Invalid credentials
- `500 Internal Server Error`: Server-side error

---

## Testing Notes

**Mock OTP**: `123456` (for development/testing only)
**Max OTP Attempts**: 3 per transaction
**OTP TTL**: 30 minutes
**Access Token TTL**: 5 minutes (300 seconds)
**Refresh Token TTL**: 1 hour
**Session TTL**: 1 hour
**Resend OTP Cooldown**: 60 seconds
