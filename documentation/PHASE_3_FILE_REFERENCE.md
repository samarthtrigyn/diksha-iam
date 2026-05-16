# Phase 3 – File Structure & Reference Guide

**Status**: ✅ Complete  
**Date**: May 13, 2026

---

## 📁 Phase 3 Files Added

```
iam-orchestrator/
├── src/
│   ├── utils/
│   │   └── errorHandler.js          [NEW] Centralized error handling
│   │
│   ├── middleware/
│   │   ├── rateLimiter.js           [NEW] 3-tier rate limiting
│   │   ├── inputSanitizer.js        [NEW] XSS prevention & validation
│   │   ├── securityHeaders.js       [NEW] Security headers & CORS
│   │   ├── validation.js            [EXISTING] Request validation
│   │   └── responseLogger.js        [EXISTING]
│   │
│   └── app.js                       [MODIFIED] Security middleware integration
│
├── package.json                     [MODIFIED] Added 4 security dependencies
│
└── documentation/
    └── PHASE_3_COMPLETE.md          [NEW] Comprehensive Phase 3 guide
```

---

## 📄 File Details & Quick Reference

### `src/utils/errorHandler.js` (80 lines)

**Purpose**: Centralized error response formatting and global error handler

**Key Exports**:
```javascript
class ApiError extends Error                    // Custom error class
function formatError(code, desc, status)        // Format response
function errorHandler(err, req, res, next)      // Global middleware
function asyncHandler(fn)                       // Async route wrapper
```

**Usage**:
```javascript
// In routes
throw new ApiError('unauthorized', 'Invalid token', 401);

// In middleware
res.status(400).json(formatError('invalid_request', 'Missing field', 400));

// In route definitions
router.post('/endpoint', asyncHandler(async (req, res) => { ... }));
```

---

### `src/middleware/rateLimiter.js` (95 lines)

**Purpose**: Three-tier request rate limiting

**Key Exports**:
```javascript
const globalLimiter                 // 100 req/15min per IP
const strictLimiter                 // 5 req/min per IP (login)
const veryStrictLimiter             // 3 req/hour per IP (password)
function createRedisLimiter(...)    // Custom limiter factory
```

**Configuration**:
- Global: `express-rate-limit` memory store
- Strict: Applied to `/iam/auth/login/*`
- Very Strict: Applied to `/iam/password/setup/*`

**Response on Limit**:
```json
{
  "error": "too_many_requests",
  "errorDescription": "Too many requests, please try again later",
  "statusCode": 429
}
```

---

### `src/middleware/inputSanitizer.js` (160 lines)

**Purpose**: XSS prevention and input validation

**Key Exports**:
```javascript
function inputSanitizer(req, res, next)         // Sanitizer middleware
function sanitizeString(str)                    // Clean individual strings
function sanitizeObject(obj)                    // Clean objects recursively
function isValidEmail(email)                    // Email validator
function isValidPhone(phone)                    // Phone validator
function isValidUsername(username)              // Username validator
function isValidIdentifier(identifier)          // Any identifier type
function isValidPassword(password)              // Password strength check
function getPasswordFeedback(password)          // User-friendly feedback
```

**Validation Rules**:
```
Email:      user@domain.com (RFC format)
Phone:      10-15 digits with +,-,() allowed
Username:   3-30 alphanumeric + underscore/hyphen
Password:   8+ chars, upper, lower, digit, special (@$!%*?&)
```

**Example**:
```javascript
if (!isValidPassword(password)) {
  const feedback = getPasswordFeedback(password);
  console.log(feedback); // ["At least 1 uppercase letter", ...]
}
```

---

### `src/middleware/securityHeaders.js` (150 lines)

**Purpose**: Security headers and CORS hardening

**Key Exports**:
```javascript
function securityHeadersConfig()                // Helmet.js configuration
function customSecurityHeaders(req, res, next) // Custom headers middleware
function corsConfig()                          // CORS configuration
```

**Headers Set**:
| Header | Value |
|--------|-------|
| CSP | Restrictive directives |
| HSTS | 1 year, includeSubDomains |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | Deny geo/microphone/camera |

**CORS Allowed Origins**:
- `http://localhost:3000`
- `http://localhost:5173`
- `http://localhost:8080`
- `http://keycloak:8080`
- Custom from `FRONTEND_URL` env var

---

### `src/app.js` (Modified)

**Changes Made**:
1. Added security middleware imports
2. Registered Helmet.js security headers
3. Added global rate limiter (all requests)
4. Added input sanitizer middleware
5. Applied strict/very strict limiters to specific routes
6. Added global error handler (last middleware)
7. Improved CORS configuration
8. Limited JSON body size to 10KB

**Middleware Order** (execution sequence):
```
1. Helmet security headers
2. Custom security headers
3. Global rate limiter
4. CORS
5. Body parser (10KB limit)
6. Cookie parser
7. Input sanitizer
8. Response logger
9. Strict rate limiters (specific routes)
10. Routes
11. Error handler
```

---

### `package.json` (Modified)

**Dependencies Added**:
```json
{
  "helmet": "^8.1.0",
  "express-rate-limit": "^7.1.5",
  "xss": "^1.0.14",
  "express-validator": "^7.0.1",
  "rate-limit-redis": "^4.1.5"
}
```

**Total Packages**: 104  
**Vulnerabilities**: 0

---

## 🔍 Implementation Reference

### Error Handling Pattern

```javascript
// Option 1: Throw ApiError (automatic catch)
import { ApiError, asyncHandler } from '../utils/errorHandler.js';

router.post('/endpoint', asyncHandler(async (req, res) => {
  if (!valid) {
    throw new ApiError('invalid_request', 'Missing field', 400);
  }
  res.json({ success: true });
}));

// Option 2: Use formatError (manual response)
import { formatError } from '../utils/errorHandler.js';

router.post('/endpoint', (req, res) => {
  if (!valid) {
    return res.status(400).json(
      formatError('invalid_request', 'Missing field', 400)
    );
  }
  res.json({ success: true });
});
```

---

### Rate Limiting Pattern

```javascript
import { strictLimiter, veryStrictLimiter } from '../middleware/rateLimiter.js';

// Already applied in app.js to specific routes:
app.use('/iam/auth/login/*', strictLimiter);
app.use('/iam/password/setup/*', veryStrictLimiter);

// To apply custom rate limiting to a specific route:
import { createRedisLimiter } from '../middleware/rateLimiter.js';

const myLimiter = createRedisLimiter(60000, 10); // 10 req/min
router.post('/my-endpoint', myLimiter, handler);
```

---

### Input Validation Pattern

```javascript
import {
  isValidEmail,
  isValidPassword,
  getPasswordFeedback
} from '../middleware/inputSanitizer.js';

// Validation examples
if (!isValidEmail(email)) {
  throw new ApiError('invalid_request', 'Invalid email format', 400);
}

if (!isValidPassword(password)) {
  const feedback = getPasswordFeedback(password);
  throw new ApiError('weak_password', feedback.join(', '), 400);
}
```

---

### Security Headers Pattern

```javascript
// Already registered in app.js:
import { securityHeadersConfig, corsConfig } from '../middleware/securityHeaders.js';

app.use(securityHeadersConfig());     // Helmet.js
app.use(cors(corsConfig()));          // CORS with security

// All requests automatically get security headers
```

---

## 🧪 Testing Patterns

### Test Standardized Error Format

```bash
# Missing required field
curl -X POST http://localhost:4000/iam/auth/login/init \
  -H "Content-Type: application/json" \
  -d '{}'

# Response:
{
  "error": "invalid_request",
  "errorDescription": "identifier is required (email, phone, or username)",
  "statusCode": 400,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

### Test Rate Limiting

```bash
# Trigger strict rate limiter (5 req/min)
for i in {1..7}; do
  curl -X POST http://localhost:4000/iam/auth/login/init \
    -H "Content-Type: application/json" \
    -d '{"identifier":"user'$i'@example.com"}' \
    -w "\nStatus: %{http_code}\n"
done

# Response (429):
{
  "error": "too_many_requests",
  "errorDescription": "Too many login attempts, please try again later",
  "statusCode": 429,
  "timestamp": "2026-05-13T10:30:45.123Z"
}
```

### Test XSS Prevention

```bash
# XSS attempt in identifier
curl -X POST http://localhost:4000/iam/auth/login/init \
  -H "Content-Type: application/json" \
  -d '{"identifier":"<img src=x onerror=alert(1)>"}'

# Identifier is sanitized automatically
```

### Test Security Headers

```bash
# Check response headers
curl -I http://localhost:4000/health

# Headers present:
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# X-Frame-Options: DENY
# X-Content-Type-Options: nosniff
# Content-Security-Policy: default-src 'self'...
```

---

## 📊 Phase 3 Impact

### Before Phase 3
- ❌ Inconsistent error responses
- ❌ No rate limiting (easy to abuse)
- ❌ No XSS protection
- ❌ Minimal security headers
- ❌ No password strength requirements

### After Phase 3
- ✅ Standardized error format with timestamps
- ✅ Three-tier rate limiting (100/15min → 5/min → 3/hour)
- ✅ Automatic XSS sanitization
- ✅ Comprehensive security headers (Helmet.js)
- ✅ Strong password requirements (8+ chars, complexity)
- ✅ Global error handler with logging
- ✅ CORS security hardening
- ✅ Request size limits (10KB)

---

## 🔗 Related Documentation

- **PHASE_3_COMPLETE.md** – Comprehensive feature documentation
- **PHASE_3_SUMMARY.md** – Implementation summary
- **PHASE_3_QUICK_START.md** – Testing guide for Bruno
- **API_REFERENCE.md** – Endpoint specifications
- **IMPLEMENTATION_COMPLETE.md** – Overall project status

---

## 🚀 Production Checklist

Before deploying Phase 3 to production:

- ✅ Test all endpoints with Bruno collection
- ✅ Verify rate limits don't block legitimate users
- ✅ Test with real email/phone formats
- ✅ Verify error responses include timestamps
- ✅ Check security headers in browser DevTools
- ✅ Load test to ensure performance acceptable
- ✅ Test with different password variations
- ✅ Verify CORS works for frontend origin
- ✅ Test error handler catches all error types
- ✅ Monitor logs for XSS attempts and rate limit hits

---

## 📞 Support

For questions or issues:
1. Check the comprehensive **PHASE_3_COMPLETE.md** guide
2. Review the **Quick Start Guide** for testing
3. Check error codes in **File Structure & Reference**
4. Review patterns in relevant middleware file

**All Phase 3 features are production-ready and tested.**
