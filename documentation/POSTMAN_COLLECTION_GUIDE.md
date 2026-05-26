# DIKSHA IAM - Postman Collection Guide

## Overview

This comprehensive Postman collection includes all DIKSHA IAM APIs organized into logical categories:

1. **🔐 Authentication & Login Flows** - Direct Grant, Registration, Password Reset
2. **👤 User Management** - User profile and session endpoints
3. **🔑 OTP Service** - Non-mocked OTP generation and verification
4. **🌐 SSO Integration** - Social Sign-On endpoints
5. **🏢 IAM Core APIs** - User CRUD operations
6. **🔐 Keycloak Admin API** - Debugging and administration
7. **🏥 System Health** - Health check endpoints

---

## Setup Instructions

### 1. Import Collection

1. Open Postman
2. Click **File** → **Import**
3. Select `DIKSHA_IAM_COMPLETE.postman_collection.json`
4. Click **Import**

### 2. Configure Environment Variables

The collection uses environment variables for easy configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `baseUrl` | http://localhost:4000 | IAM Orchestrator base URL |
| `iamCoreUrl` | http://localhost:3000 | IAM Core service URL |
| `keycloakUrl` | http://localhost:8080 | Keycloak base URL |
| `keycloakRealm` | diksha-demo | Keycloak realm name |
| `kcAdminSecret` | admin-secret-change-in-production | Keycloak admin client secret |

**To update variables:**

1. Click the **Environment** icon (eye icon) in top right
2. Select **Edit** next to your environment
3. Update values as needed
4. Click **Save**

---

## Testing Workflows

### Workflow 1: Complete Registration Flow

Test a new user registration from start to finish:

```
1. Registration - Init
   └─ Saves: {{txnId}}

2. Registration - Send OTP
   └─ Uses: {{txnId}}

3. Registration - Verify OTP
   └─ Uses: {{txnId}}, OTP: 123456

4. Registration - Complete
   └─ Uses: {{txnId}}
   └─ Saves: {{newUserId}}

5. Direct Grant Login
   └─ Uses: new user credentials
   └─ Saves: {{accessToken}}, {{refreshToken}}, {{sessionId}}
```

**Expected Results:**
- Init: 200 OK with txnId
- Send OTP: 200 OK with nextStep: "VERIFY_OTP"
- Verify OTP: 200 OK with nextStep: "SET_PASSWORD"
- Complete: 201 Created with user object and nextStep: "LOGIN"
- Login: 200 OK with JWT tokens

---

### Workflow 2: Existing User Login

Test login with an existing active user:

```
1. Direct Grant Login
   └─ Email: testuser@diksha.local
   └─ Password: Test@123456
   └─ Saves: {{accessToken}}, {{refreshToken}}, {{sessionId}}

2. Get Current User
   └─ Uses: {{accessToken}}
```

**Expected Results:**
- Login: 200 OK with real JWT tokens
- Get User: 200 OK with user profile

---

### Workflow 3: Password Reset Flow

Test password reset functionality:

```
1. Reset Password - Init
   └─ Email: testuser@diksha.local
   └─ Saves: {{txnId}}

2. Reset Password - Verify OTP
   └─ Uses: {{txnId}}, OTP: 123456

3. Reset Password - Complete
   └─ Uses: {{txnId}}
   └─ New password set

4. Direct Grant Login
   └─ Uses: new password credentials
   └─ Saves: {{accessToken}}, {{refreshToken}}
```

**Expected Results:**
- Init: 200 OK with txnId
- Verify OTP: 200 OK
- Complete: 200 OK
- Login: 200 OK with new tokens

---

### Workflow 4: Token Refresh

Test token refresh functionality:

```
1. Direct Grant Login
   └─ Saves: {{refreshToken}}

2. Refresh Token
   └─ Uses: {{refreshToken}}
   └─ Gets new: {{accessToken}}
```

**Expected Results:**
- Login: 200 OK
- Refresh: 200 OK with new access token

---

### Workflow 5: Keycloak Admin Operations

Debug Keycloak user state:

```
1. Get Keycloak Admin Token
   └─ Saves: {{kcAdminToken}}

2. List Keycloak Users
   └─ Uses: {{kcAdminToken}}

3. Search Keycloak User by Email
   └─ Uses: {{kcAdminToken}}
   └─ Gets Keycloak user details

4. Get Keycloak User Sessions
   └─ Uses: {{kcUserId}} from search
   └─ Views all active sessions
```

**Expected Results:**
- Admin Token: 200 OK
- List Users: 200 OK with user array
- Search: 200 OK with single user
- Sessions: 200 OK with session list

---

## Key Features

### Auto-Token Management

Several requests have **Test scripts** that automatically save tokens to environment variables:

- **Direct Grant Login** → Saves `accessToken`, `refreshToken`, `sessionId`, `userId`
- **Refresh Token** → Updates `accessToken`
- **Get Keycloak Admin Token** → Saves `kcAdminToken`
- **Registration - Complete** → Saves `newUserId`

This means you can chain requests without manually copying values!

### Pre-configured Request Bodies

All requests have example payloads that you can modify:

- Email addresses: Change from `testuser@diksha.local` to your test user
- Passwords: Change from `Test@123456` to your test password
- OTP Code: Mock code is `123456` (for development)

### Bearer Token Authentication

Most endpoints use the `Authorization: Bearer {{accessToken}}` header, which is automatically populated after login.

---

## Testing Different Scenarios

### New User Signup + Login
1. Run: **Registration - Init** (change email)
2. Run: **Registration - Send OTP**
3. Run: **Registration - Verify OTP**
4. Run: **Registration - Complete** (set password)
5. Run: **Direct Grant Login** (use same credentials)

### Existing User Quick Login
1. Run: **Direct Grant Login** (use testuser@diksha.local)

### Password Recovery
1. Run: **Forgot Password - Init**
2. Run: **Forgot Password - Verify OTP**
3. Run: **Forgot Password - Complete** (set new password)
4. Run: **Direct Grant Login** (verify new password works)

### User Profile Access
1. Run: **Direct Grant Login** (to get token)
2. Run: **Get Current User** (requires token from step 1)

### Keycloak Debugging
1. Run: **Get Keycloak Admin Token**
2. Run: **Search Keycloak User by Email** (find a user)
3. Run: **Get Keycloak User Sessions** (see active sessions)

---

## Common Error Scenarios

### 400 Bad Request - "Invalid credentials"
- **Cause**: Wrong email/password combination
- **Fix**: Use testuser@diksha.local with password Test@123456

### 400 Bad Request - "Transaction not found"
- **Cause**: txnId expired (30 minutes) or invalid
- **Fix**: Start over with **Registration - Init** or **Forgot Password - Init**

### 400 Bad Request - "Invalid OTP"
- **Cause**: Wrong OTP code
- **Fix**: Use mock code `123456` in development

### 401 Unauthorized
- **Cause**: Token expired or invalid
- **Fix**: Run **Direct Grant Login** again to get fresh token, or use **Refresh Token**

### 404 Not Found - User not in Keycloak
- **Cause**: User created in IAM DB but not synced to Keycloak
- **Fix**: Check Keycloak logs, re-run registration complete

---

## Environment Setup for Docker

If running services in Docker, ensure these are correct:

```json
{
  "baseUrl": "http://localhost:4000",
  "iamCoreUrl": "http://localhost:3000",
  "keycloakUrl": "http://localhost:8080",
  "keycloakRealm": "diksha-demo"
}
```

If Docker services are on different host:

```json
{
  "baseUrl": "http://192.168.x.x:4000",
  "iamCoreUrl": "http://192.168.x.x:3000",
  "keycloakUrl": "http://192.168.x.x:8080"
}
```

---

## OTP Testing

### Mock OTP Code
In **development**, the mock OTP code is: `123456`

Use this code for all OTP verification requests:
- **Registration - Verify OTP**
- **Forgot Password - Verify OTP**

### Real OTP (Non-Mocked)
For non-development environments:

1. Run: **Generate OTP** (sends real OTP to email)
2. Check email for OTP code
3. Run: **Verify OTP** (with code from email)

---

## JWT Token Structure

Tokens returned by login endpoints are real JWT tokens with:

```
Header:  {alg: "RS256", typ: "JWT"}

Access Token (5 min TTL):
{
  sub: "user-id",
  email: "user@diksha.local",
  preferred_username: "username",
  given_name: "first-name",
  family_name: "last-name",
  email_verified: true,
  name: "full-name",
  iat: 1234567890,
  exp: 1234568190
}

ID Token (5 min TTL):
{
  sub: "user-id",
  email: "user@diksha.local",
  aud: "diksha-portal",
  iat: 1234567890,
  exp: 1234568190
}

Refresh Token (1 hour TTL):
Used to obtain new access/ID tokens
```

---

## Rate Limiting

The following endpoints have rate limiting:

| Endpoint | Limit | Window |
|----------|-------|--------|
| Register Init | 5 | 1 hour |
| Send OTP | 5 | 1 hour |
| Verify OTP | 3 | 1 hour |
| Forgot Password Init | 5 | 1 hour |
| Login | 10 | 5 minutes |

Rate limit headers in response:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1685023450
```

---

## Troubleshooting

### Keycloak Admin Token Not Working
1. Verify `kcAdminSecret` is correct in environment
2. Check Keycloak is running: `docker logs keycloak`
3. Verify client `iam-admin-client` exists in Keycloak realm

### Access Token Invalid After 5 Minutes
1. Use **Refresh Token** endpoint with `refreshToken` from login
2. Or run **Direct Grant Login** again

### User Not Found After Registration
1. Run **Search Keycloak User by Email** to check if created
2. Check registration complete response returned user ID
3. Check IAM Core logs for sync errors

### Email Not Received for OTP
1. Check email service configuration
2. Verify email address is valid
3. Check application logs for SMTP errors

---

## Quick Reference

### Import & Setup (First Time)
```
1. Import DIKSHA_IAM_COMPLETE.postman_collection.json
2. Create/select environment
3. Set baseUrl = http://localhost:4000
4. Set keycloakUrl = http://localhost:8080
5. Save environment
```

### Test Complete Flow
```
1. Registration - Init           (get txnId)
2. Registration - Send OTP       (send code)
3. Registration - Verify OTP     (verify with 123456)
4. Registration - Complete       (create user)
5. Direct Grant Login            (get tokens)
6. Get Current User              (verify profile)
```

### Debug User in Keycloak
```
1. Get Keycloak Admin Token      (get kcAdminToken)
2. Search Keycloak User by Email (find user)
3. Get Keycloak User Sessions    (view sessions)
```

---

## Next Steps

1. **Import the collection** into Postman
2. **Configure your environment** variables
3. **Run the health checks** to verify services
4. **Test the complete registration flow** with a new email
5. **Test login with existing user** (testuser@diksha.local)
6. **Debug in Keycloak** using admin endpoints

---

## Support

For issues or questions:
- Check Docker logs: `docker-compose logs iam-orchestrator`
- Check Keycloak logs: `docker-compose logs keycloak`
- Review response error messages for specific errors
- Check ENDPOINTS_ANALYSIS.md for detailed API documentation
