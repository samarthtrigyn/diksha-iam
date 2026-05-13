# Phase 3 Security Features – Quick Start Guide

**Updated**: May 13, 2026  
**For**: Bruno HTTP Client & Integration Testing

---

## 🚀 Getting Started with Phase 3

Phase 3 adds automatic security protection to all API endpoints. No changes needed to your test workflows – the security is transparent.

---

## 📊 Rate Limiting Behavior

### What to Expect

When testing in Bruno, you may encounter `429 Too Many Requests` responses if you:
- Send more than **5 login requests per minute**
- Send more than **3 password setup requests per hour**
- Send more than **100 requests per 15 minutes** (any endpoint)

### Response Format

```json
{
  "error": "too_many_requests",
  "errorDescription": "Too many login attempts, please try again later",
  "statusCode": 429,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

### How to Handle in Tests

**In Bruno test scripts**, add a check for rate limiting:

```javascript
bru.test('Status is success or rate limited', () => {
  const status = bru.getStatus();
  expect(status === 200 || status === 429).to.be.true;
});

if (bru.getStatus() === 429) {
  bru.log('Rate limited - waiting before retry...');
  // Your test framework should wait before retrying
}
```

---

## 🔐 Error Response Format

### All Errors Now Include

```json
{
  "error": "error_code",
  "errorDescription": "Human-readable message",
  "statusCode": 400,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

### Error Codes You'll See

| Code | Status | Meaning |
|------|--------|---------|
| `invalid_request` | 400 | Missing or invalid parameters |
| `unauthorized` | 401 | Missing authentication |
| `user_not_found` | 404 | User doesn't exist |
| `too_many_requests` | 429 | Rate limit exceeded |
| `invalid_token` | 401 | JWT token invalid/expired |
| `provider_error` | 502 | Keycloak unreachable |
| `internal_error` | 500 | Server error |

### Testing Error Responses

```bash
# Test missing parameter
curl -X POST http://localhost:4000/iam/auth/login/init \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected response (400):
{
  "error": "invalid_request",
  "errorDescription": "identifier is required (email, phone, or username)",
  "statusCode": 400,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

---

## 🛡️ XSS Prevention

### What Changed

All user input is now automatically sanitized to remove XSS attempts.

### Example

**Input (with XSS attempt)**:
```json
{
  "identifier": "<script>alert('xss')</script>"
}
```

**After Sanitization**:
```
identifier = "scriptalertxssscript"
```

### In Your Tests

You **don't need to do anything** – sanitization is automatic. Just use normal identifiers:

```json
{
  "identifier": "user@example.com"
}
```

---

## 📝 Password Strength Validation

### Requirements

Passwords must contain:
- ✅ At least **8 characters**
- ✅ At least **1 uppercase letter** (A-Z)
- ✅ At least **1 lowercase letter** (a-z)
- ✅ At least **1 digit** (0-9)
- ✅ At least **1 special character** (@$!%*?&)

### Valid Password Example

```
MyPassword123!
```

### Error Response (Weak Password)

```json
{
  "error": "weak_password",
  "errorDescription": "At least 1 uppercase letter, At least 1 special character (@$!%*?&)",
  "statusCode": 400,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

---

## ✉️ Email & Phone Validation

### Supported Identifier Formats

**Email**:
```
user@example.com
test.user@domain.co.uk
```

**Phone**:
```
+1-234-567-8900
(234) 567-8900
234 567 8900
2345678900
```

**Username**:
```
john_doe
user-123
testuser
```

### Invalid Examples

```
test (no @domain) ❌
123 (too short) ❌
test!user (invalid chars) ❌
+1234567890 (too short) ❌
```

---

## 🔄 Security Headers in Responses

### What the Server Now Sends

Every response includes security headers:

```
Content-Security-Policy: default-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

### In Bruno

These headers are automatically handled. You don't need to validate them unless you have specific security requirements.

---

## 🧪 Testing Phase 3 Features in Bruno

### Create a Test Collection

1. **Import** the Bruno-compatible collection
2. **Add test scripts** (examples below)
3. **Run with delays** between sensitive endpoint tests

### Sample Test Script

```javascript
// Check status and error format
bru.test('Status is valid', () => {
  expect(bru.getStatus()).to.be.oneOf([200, 201, 400, 401, 404, 429, 500]);
});

// Verify standardized error format
const body = bru.getBody();
if (bru.getStatus() >= 400) {
  bru.test('Error has required fields', () => {
    expect(body).to.have.property('error');
    expect(body).to.have.property('errorDescription');
    expect(body).to.have.property('statusCode');
    expect(body).to.have.property('timestamp');
  });
}

// Rate limit awareness
if (bru.getStatus() === 429) {
  bru.test('Rate limit error format', () => {
    expect(body.error).to.equal('too_many_requests');
  });
  bru.log('⚠️ Rate limited – consider waiting before next request');
}
```

---

## ⏱️ Testing Rate Limits Safely

### Recommended Approach

**Don't stress-test rate limits in normal testing. Instead:**

1. **Test each endpoint once** in sequence
2. **Wait 30-60 seconds** between login attempts
3. **Use different identifiers** to avoid hitting limits

### Stress Testing (Optional)

If you need to test rate limiting behavior:

```bash
# Create a separate test script
# Start server locally
# Send requests in quick succession
# Monitor for 429 responses

for i in {1..10}; do
  echo "Request $i..."
  curl -X POST http://localhost:4000/iam/auth/login/init \
    -H "Content-Type: application/json" \
    -d '{"identifier":"test'$i'@example.com"}' \
    -w "\nStatus: %{http_code}\n"
  sleep 0.1
done
```

---

## 🐛 Troubleshooting

### Issue: "Too many requests" (429) on First Test

**Cause**: Previous test run didn't complete, rate limit counter still active

**Solution**: 
- Wait 2 minutes (global limiter resets)
- Use a different identifier
- Restart the server (clears memory-based rate limiter)

### Issue: "invalid_request" with Strange Description

**Cause**: Input was sanitized (XSS attempt detected)

**Solution**: Use plain text identifiers without special characters

### Issue: "weak_password" Error

**Cause**: Password doesn't meet strength requirements

**Solution**: Use password like `MyNewPass123!` with:
- 8+ characters
- Upper + lowercase
- Number
- Special character

---

## 📊 Testing Workflow with Phase 3

### Recommended Flow A – Login (Direct Grant)

```
1. POST /iam/auth/login/init
   - Identifier: user@example.com
   - Response: txnId

2. [WAIT 5 seconds]

3. POST /iam/auth/login/password
   - txnId: [from step 1]
   - Password: Password123!
   - Response: sessionId (cookie)

4. GET /iam/users/me
   - Uses cookie from step 3
   - Response: User profile
```

### Recommended Flow B – New User (OTP)

```
1. POST /iam/password/setup/init
   - Identifier: newuser@example.com
   - Response: txnId

2. [WAIT 10+ seconds for OTP delivery]

3. POST /iam/password/setup/complete
   - txnId: [from step 1]
   - OTP: [from email/SMS]
   - Response: authUrl

4. [WAIT 5 seconds]

5. GET /iam/auth/callback
   - code: [from authUrl]
   - state: [from authUrl]
   - Response: sessionId (cookie)
```

---

## 🎯 Phase 3 Security Checklist for Tests

- ✅ All errors include `timestamp` field
- ✅ All errors have `error` and `errorDescription` fields
- ✅ Rate limit responses are handled (wait & retry)
- ✅ Security headers present in responses
- ✅ XSS attempts are blocked (sanitized)
- ✅ Weak passwords rejected with feedback
- ✅ Invalid identifiers rejected

---

## 📞 Need Help?

**Common Issues**:
1. Rate limited? → Wait 60 seconds or restart server
2. Weak password? → Add uppercase, number, and special character
3. Invalid identifier? → Use email/phone/username format
4. Sanitized input? → Don't include HTML/scripts in identifiers

**Reference Documentation**:
- `PHASE_3_COMPLETE.md` – Full Phase 3 details
- `PHASE_3_SUMMARY.md` – Feature summary
- `documentation/API_REFERENCE.md` – Endpoint details

---

## 🚀 Ready to Test!

All endpoints are now secured with Phase 3 protections. Your Bruno tests will automatically benefit from:
- ✅ Rate limiting (prevents abuse)
- ✅ Input sanitization (prevents XSS)
- ✅ Security headers (defense in depth)
- ✅ Strong password requirements
- ✅ Standardized error responses

**Go ahead and import the collection into Bruno and start testing! 🎉**
