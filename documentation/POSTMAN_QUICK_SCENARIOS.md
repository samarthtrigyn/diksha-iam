# DIKSHA IAM Postman - Quick Testing Scenarios

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Postman installed
- Docker services running (iam-orchestrator, keycloak, redis, iam-core)
- Collection imported
- Environment configured

### 60-Second Test
```
1️⃣  Direct Grant Login
    POST {{baseUrl}}/iam/auth/login/direct-grant
    {
      "identifier": "testuser@diksha.local",
      "password": "Test@123456",
      "clientId": "diksha-portal"
    }
    ✅ Expected: 200 OK with tokens

2️⃣  Get Current User
    GET {{baseUrl}}/iam/users/me
    Header: Authorization: Bearer {{accessToken}}
    ✅ Expected: 200 OK with user profile
```

---

## 📋 Scenario 1: New User Registration (Complete Flow)

**Duration**: 2-3 minutes  
**Test Email**: Use unique email like `testuser_{{$timestamp}}@diksha.local`

### Step-by-Step

**1. Initialize Registration**
```
POST /iam/auth/register/init
{
  "identifier": "newuser_1234@diksha.local"
}
✅ Response: 200 OK
   Save: txnId, nextStep should be "SEND_OTP"
```

**2. Send OTP Code**
```
POST /iam/auth/register/send-otp
{
  "txnId": "{{txnId}}"
}
✅ Response: 200 OK
   nextStep should be "VERIFY_OTP"
```

**3. Verify OTP**
```
POST /iam/auth/register/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "123456"
}
✅ Response: 200 OK
   nextStep should be "SET_PASSWORD"
```

**4. Complete Registration**
```
POST /iam/auth/register/complete
{
  "txnId": "{{txnId}}",
  "password": "MyPass@12345",
  "confirmPassword": "MyPass@12345",
  "termsAccepted": true
}
✅ Response: 201 Created
   Response body shows user object
   nextStep should be "LOGIN"
```

**5. Login with New User**
```
POST /iam/auth/login/direct-grant
{
  "identifier": "newuser_1234@diksha.local",
  "password": "MyPass@12345",
  "clientId": "diksha-portal"
}
✅ Response: 200 OK
   Got: accessToken, idToken, refreshToken, sessionId
```

**6. Verify User Profile**
```
GET /iam/users/me
Header: Authorization: Bearer {{accessToken}}
✅ Response: 200 OK
   Shows user email, username, roles
```

---

## 🔓 Scenario 2: Existing User Login (Quick)

**Duration**: 10 seconds  
**Test Email**: testuser@diksha.local

### Steps

**1. Direct Grant Login**
```
POST /iam/auth/login/direct-grant
{
  "identifier": "testuser@diksha.local",
  "password": "Test@123456",
  "clientId": "diksha-portal"
}
✅ Response: 200 OK
   accessToken, idToken, refreshToken received
```

**2. Verify Session**
```
GET /iam/users/me
Header: Authorization: Bearer {{accessToken}}
✅ Response: 200 OK
   User profile returned
```

---

## 🔑 Scenario 3: Forgot Password (Complete Flow)

**Duration**: 1-2 minutes  
**Test Email**: testuser@diksha.local

### Steps

**1. Initialize Password Reset**
```
POST /iam/auth/reset-password/init
{
  "identifier": "testuser@diksha.local"
}
✅ Response: 200 OK
   Save: txnId
```

**2. Verify OTP**
```
POST /iam/auth/reset-password/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "123456"
}
✅ Response: 200 OK
```

**3. Complete Password Reset**
```
POST /iam/auth/reset-password/complete
{
  "txnId": "{{txnId}}",
  "password": "NewPass@54321",
  "confirmPassword": "NewPass@54321"
}
✅ Response: 200 OK
```

**4. Login with New Password**
```
POST /iam/auth/login/direct-grant
{
  "identifier": "testuser@diksha.local",
  "password": "NewPass@54321",
  "clientId": "diksha-portal"
}
✅ Response: 200 OK
   New tokens received
```

**5. Reset Password Back (Optional)**
```
(Repeat steps 1-4 with original password)
```

---

## 🔄 Scenario 4: Token Refresh

**Duration**: 30 seconds

### Steps

**1. Get Initial Tokens**
```
POST /iam/auth/login/direct-grant
{
  "identifier": "testuser@diksha.local",
  "password": "Test@123456",
  "clientId": "diksha-portal"
}
✅ Response: 200 OK
   Save: {{refreshToken}}
```

**2. Use Access Token**
```
GET /iam/users/me
Header: Authorization: Bearer {{accessToken}}
✅ Response: 200 OK
```

**3. Refresh Token (After 5+ minutes)**
```
POST /iam/auth/refresh
{
  "refreshToken": "{{refreshToken}}",
  "clientId": "diksha-portal"
}
✅ Response: 200 OK
   New accessToken received
```

**4. Use New Token**
```
GET /iam/users/me
Header: Authorization: Bearer {{accessToken}} (new one)
✅ Response: 200 OK
```

---

## 🔐 Scenario 5: Keycloak Debugging

**Duration**: 1 minute  
**Purpose**: Verify user creation, check sessions

### Steps

**1. Get Admin Token**
```
POST /realms/diksha-demo/protocol/openid-connect/token
Body (form-urlencoded):
  grant_type: client_credentials
  client_id: iam-admin-client
  client_secret: {{kcAdminSecret}}
✅ Response: 200 OK
   Save: {{kcAdminToken}}
```

**2. List All Users**
```
GET /admin/realms/diksha-demo/users
Header: Authorization: Bearer {{kcAdminToken}}
Query: max=50&first=0
✅ Response: 200 OK
   Array of users shown
```

**3. Search Specific User**
```
GET /admin/realms/diksha-demo/users
Header: Authorization: Bearer {{kcAdminToken}}
Query: email=testuser@diksha.local
✅ Response: 200 OK
   Single user object shown
   Save: kcUserId from response
```

**4. Check User Sessions**
```
GET /admin/realms/diksha-demo/users/{{kcUserId}}/sessions
Header: Authorization: Bearer {{kcAdminToken}}
✅ Response: 200 OK
   Active sessions listed
```

**5. Force Logout User (If Needed)**
```
POST /admin/realms/diksha-demo/users/{{kcUserId}}/logout
Header: Authorization: Bearer {{kcAdminToken}}
✅ Response: 204 No Content
   User sessions invalidated
```

---

## 🧪 Scenario 6: Error Handling - Wrong Password

**Duration**: 10 seconds  
**Purpose**: Verify error response handling

### Steps

**1. Login with Wrong Password**
```
POST /iam/auth/login/direct-grant
{
  "identifier": "testuser@diksha.local",
  "password": "WrongPassword",
  "clientId": "diksha-portal"
}
❌ Expected: 401 Unauthorized
   Error: "Invalid credentials"
   Status: 401
```

**2. Verify Previous Token Still Works**
```
GET /iam/users/me
Header: Authorization: Bearer {{accessToken}} (from previous login)
✅ Response: 200 OK
   Still valid
```

---

## 🧪 Scenario 7: Error Handling - Expired Transaction

**Duration**: 10 seconds  
**Purpose**: Verify transaction timeout

### Steps

**1. Initialize Registration**
```
POST /iam/auth/register/init
{
  "identifier": "newuser_test@diksha.local"
}
✅ Response: 200 OK
   Save: txnId
```

**2. Wait 31 Minutes (Or Use Old txnId)**
```
(Simulated: Use txnId from > 30 minutes ago)
```

**3. Try to Use Expired Transaction**
```
POST /iam/auth/register/send-otp
{
  "txnId": "expired-txn-id"
}
❌ Expected: 400 Bad Request
   Error: "Transaction not found" or "Transaction expired"
   Status: 400
```

**4. Start Over**
```
POST /iam/auth/register/init
{
  "identifier": "newuser_test@diksha.local"
}
✅ Response: 200 OK
   New txnId issued
```

---

## 🧪 Scenario 8: Error Handling - Too Many OTP Attempts

**Duration**: 1 minute  
**Purpose**: Verify OTP attempt limiting

### Steps

**1. Initialize Registration**
```
POST /iam/auth/register/init
{
  "identifier": "newuser_test@diksha.local"
}
✅ Response: 200 OK
   Save: {{txnId}}
```

**2. Send OTP**
```
POST /iam/auth/register/send-otp
{
  "txnId": "{{txnId}}"
}
✅ Response: 200 OK
```

**3. Attempt 1: Wrong OTP**
```
POST /iam/auth/register/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "000000"
}
❌ Response: 400 Bad Request
   Error: "Invalid OTP"
```

**4. Attempt 2: Wrong OTP**
```
POST /iam/auth/register/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "111111"
}
❌ Response: 400 Bad Request
   Error: "Invalid OTP"
```

**5. Attempt 3: Wrong OTP**
```
POST /iam/auth/register/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "222222"
}
❌ Response: 400 Bad Request
   Error: "Invalid OTP" + "Max attempts exceeded"
```

**6. Attempt 4: Correct OTP (Now Blocked)**
```
POST /iam/auth/register/verify-otp
{
  "txnId": "{{txnId}}",
  "otp": "123456"
}
❌ Response: 429 Too Many Requests
   Error: "Max OTP attempts exceeded"
   Status: 429
```

**7. Start Over**
```
POST /iam/auth/register/init
{
  "identifier": "newuser_test@diksha.local"
}
✅ Response: 200 OK
   New transaction needed
```

---

## 🔗 Scenario 9: SSO Login (Google)

**Duration**: 2-3 minutes  
**Purpose**: Test social login flow

### Steps

**1. Get SSO Providers**
```
GET /iam/sso
✅ Response: 200 OK
   List of configured providers (google, etc.)
```

**2. Initiate Google Login**
```
GET /iam/sso/google/login
✅ Response: 302 Redirect
   Redirects to Google OAuth consent screen
   (Cannot test directly in Postman - would need browser)
```

---

## ⚙️ Scenario 10: Health & System Checks

**Duration**: 20 seconds  
**Purpose**: Verify all services running

### Steps

**1. Check IAM Orchestrator**
```
GET /health
URL: {{baseUrl}}/health
✅ Response: 200 OK
   {
     "status": "ok",
     "service": "iam-orchestrator"
   }
```

**2. Check IAM Core**
```
GET /health
URL: {{iamCoreUrl}}/health
✅ Response: 200 OK
   {
     "status": "ok",
     "service": "iam-core"
   }
```

**3. Get Keycloak Realm Info**
```
GET /admin/realms/diksha-demo
Header: Authorization: Bearer {{kcAdminToken}}
URL: {{keycloakUrl}}/admin/realms/diksha-demo
✅ Response: 200 OK
   Realm configuration shown
```

---

## 📊 Scenario Checklist

Use this to track which scenarios you've tested:

- [ ] Scenario 1: Complete Registration (New User)
- [ ] Scenario 2: Existing User Login
- [ ] Scenario 3: Reset Password
- [ ] Scenario 4: Token Refresh
- [ ] Scenario 5: Keycloak Debugging
- [ ] Scenario 6: Error - Wrong Password
- [ ] Scenario 7: Error - Expired Transaction
- [ ] Scenario 8: Error - Too Many OTP Attempts
- [ ] Scenario 9: SSO Google Login
- [ ] Scenario 10: Health Checks

---

## 🎯 Variable Auto-Population

Some requests automatically save values to environment:

| Request | Saves |
|---------|-------|
| Direct Grant Login | `accessToken`, `refreshToken`, `sessionId`, `userId` |
| Registration - Complete | `newUserId` |
| Refresh Token | `accessToken` (updated) |
| Get Keycloak Admin Token | `kcAdminToken` |
| Search Keycloak User | `kcUserId` |

This means you can chain requests without manual copy-paste!

---

## 🚨 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Login first to get `{{accessToken}}` |
| 400 Transaction not found | txnId expired after 30 min - start over |
| 400 Invalid OTP | Use code `123456` (mock), or check email for real code |
| 429 Too many requests | Wait or reset transaction |
| 404 User not found | Check email - might not be created yet |
| Connection refused | Docker services not running - `docker-compose up` |

---

## 💡 Pro Tips

1. **Use Unique Emails**: Add timestamp to avoid duplicates
   ```
   newuser_{{$timestamp}}@diksha.local
   ```

2. **Save txnId**: After registration init, save to environment
   ```
   Copy value from response
   Click "..." → "Set as variable" → {{txnId}}
   ```

3. **Copy Full Response**: Click "..." → "Copy response body" for debugging

4. **Watch Tests Tab**: Check "Tests" tab to see which variables were auto-saved

5. **Use Mock OTP**: In development, always use `123456`

6. **Check Response Headers**: HTTP 201 = Created, 200 = OK, 4xx = Error

---

## 🔄 Quick Flow Reference

```
NEW USER:
  Register Init → Send OTP → Verify OTP → Complete → Login

EXISTING USER:
  Login (Direct Grant)

RESET PASSWORD:
  Init → Verify OTP → Complete → Login

TOKEN MANAGEMENT:
  Login → Refresh Token → Use New Token

KEYCLOAK DEBUG:
  Admin Token → Search User → Check Sessions → (Optional) Logout
```

---

## 📚 Related Documentation

- **DIKSHA_IAM_COMPLETE.postman_collection.json** - Full Postman collection
- **POSTMAN_COLLECTION_GUIDE.md** - Detailed usage guide
- **LOGIN_FLOWS_COMPLETE.md** - API documentation with examples
- **ENDPOINTS_ANALYSIS.md** - Complete endpoint specifications

---

Last Updated: May 26, 2026
