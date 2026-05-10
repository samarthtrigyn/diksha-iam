import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHmac, randomBytes, createHash } from 'crypto';
import dotenv from 'dotenv';
import { createClient } from 'redis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────
const IAM_SERVICE_URL    = process.env.IAM_USER_SERVICE_URL || 'http://iam-service:3000';
const KEYCLOAK_URL       = process.env.KEYCLOAK_URL       || 'http://keycloak:8080';
const KEYCLOAK_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8080';
const KEYCLOAK_REALM     = process.env.KEYCLOAK_REALM     || 'diksha-demo';
// Service account for Admin API calls (client_credentials grant, NO admin password needed)
const KC_ADMIN_CLIENT_ID     = process.env.KEYCLOAK_CLIENT_ID     || 'iam-admin-client';
const KC_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'iam-admin-client-secret';
// Public/portal client used in OAuth2 authorization and token exchange flows
const KEYCLOAK_CLIENT_ID     = process.env.KEYCLOAK_PORTAL_CLIENT_ID || 'diksha-portal';
// Shared secret for signing activation tokens (must match ACTIVATION_TOKEN_SECRET in Keycloak env)
const ACTIVATION_TOKEN_SECRET = process.env.ACTIVATION_TOKEN_SECRET || 'change-me-in-production';
// Mock OTP toggle
const USE_MOCK_OTP  = process.env.USE_MOCK_OTP  === 'true';
const MOCK_OTP_CODE = process.env.MOCK_OTP_CODE || '123456';
const FRONTEND_REDIRECT_URI = process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173/auth/callback';
// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ──────────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true
}));
app.use(express.json());

// Initialize Redis client
const initRedis = async () => {
  redisClient = createClient({ url: REDIS_URL });
  
  redisClient.on('error', (err) => console.error(`[REDIS] Client error ${getLineNum()}:`, err));
  redisClient.on('connect', () => console.log(`[REDIS] Connected to Redis ${getLineNum()}`));
  redisClient.on('ready', () => console.log(`[REDIS] Redis client ready ${getLineNum()}`));
  
  try {
    await redisClient.connect();
  } catch (err) {
    console.error(`[REDIS] Failed to connect ${getLineNum()}:`, err.message);
    throw err;
  }
};

// Log responses for debugging
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (req.path === '/iam/activation/verify-otp') {
      console.log(`[RESPONSE] verify-otp response being sent ${getLineNum()}:`, JSON.stringify(data).substring(0, 200));
    }
    return originalJson.call(this, data);
  };
  next();
});

// ──────────────────────────────────────────────────────────────────────────────
// Stores (all in Redis for consistency)
// ──────────────────────────────────────────────────────────────────────────────

// Redis client for migration store (persistent across application restarts)
let redisClient;

// ──────────────────────────────────────────────────────────────────────────────
// Redis Store Operations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get or set mapping between IAM userId and Keycloak userId
 * mapping:{iamUserId} → { iamUserId, keycloakUserId, username, activationStatus, updatedAt }
 */
const mappingStore = {
  async get(iamUserId) {
    try {
      const data = await redisClient.get(`mapping:user:${iamUserId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting mapping ${getLineNum()}:`, err.message);
      return null;
    }
  },
  
  async set(iamUserId, value) {
    try {
      // 24-hour TTL for mapping
      await redisClient.setEx(`mapping:user:${iamUserId}`, 86400, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting mapping ${getLineNum()}:`, err.message);
    }
  },
  
  async delete(iamUserId) {
    try {
      await redisClient.del(`mapping:user:${iamUserId}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting mapping ${getLineNum()}:`, err.message);
    }
  }
};

/**
 * Store transaction data indexed by txnId
 * txn:{txnId} → { identifier, iamUserId, codeVerifier, codeChallenge, redirectUri, clientId, expiresAt }
 */
const txnStore = {
  async get(txnId) {
    try {
      const data = await redisClient.get(`txn:${txnId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting txn ${getLineNum()}:`, err.message);
      return null;
    }
  },
  
  async set(txnId, value) {
    try {
      // 10-minute TTL for transactions
      await redisClient.setEx(`txn:${txnId}`, 600, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting txn ${getLineNum()}:`, err.message);
    }
  },
  
  async delete(txnId) {
    try {
      await redisClient.del(`txn:${txnId}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting txn ${getLineNum()}:`, err.message);
    }
  }
};

/**
 * Store state data indexed by state
 * state:{state} → { identifier, iamUserId, keycloakUserId, codeVerifier, nonce, activationStatus, expiresAt }
 */
const stateStore = {
  async get(state) {
    try {
      const data = await redisClient.get(`state:${state}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting state ${getLineNum()}:`, err.message);
      return null;
    }
  },
  
  async set(state, value) {
    try {
      // 10-minute TTL for state
      await redisClient.setEx(`state:${state}`, 600, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting state ${getLineNum()}:`, err.message);
    }
  },
  
  async delete(state) {
    try {
      await redisClient.del(`state:${state}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting state ${getLineNum()}:`, err.message);
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
const getLineNum = () => {
  try {
    const stack = new Error().stack.split('\n')[2];
    const match = stack.match(/:\d+:(\d+)/);
    return match ? `[L${match[1]}]` : '';
  } catch {
    return '';
  }
};

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const maskIdentifier = (id) =>
  isEmail(id)
    ? id.replace(/(.{2})[^@]*(@.*)/, '$1***$2')
    : id.replace(/(\d{2})\d*(\d{2})/, '$1****$2');

/**
 * Generate PKCE code_verifier and code_challenge.
 * code_verifier: 43-128 character random string (use 128 for max security)
 * code_challenge: base64url(sha256(code_verifier))
 */
function generatePKCE() {
  const codeVerifier = Buffer.from(randomBytes(96)).toString('base64url');
  const hash = createHash('sha256');
  hash.update(codeVerifier);
  const codeChallenge = hash.digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Validate JWT token claims (issuer, audience, nonce, expiry)
 */
function validateTokenClaims(token, expectedNonce, expectedIssuer, expectedAudience) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch (err) {
    throw new Error(`Malformed token payload: ${err.message}`);
  }

  const now = Math.floor(Date.now() / 1000);

  // Validate expiry
  if (payload.exp && payload.exp <= now) {
    throw new Error(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
  }

  // Validate issuer
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
  }

  // Validate audience (can be string or array)
  if (expectedAudience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(expectedAudience)) {
      throw new Error(`Invalid audience: ${expectedAudience} not in ${aud.join(', ')}`);
    }
  }

  // Validate nonce (for ID token)
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error(`Invalid nonce: expected ${expectedNonce}, got ${payload.nonce}`);
  }

  return payload;
}

/**
 * Log Keycloak request/response for debugging
 */
const logKeycloakCall = (method, endpoint, statusCode, data = null, error = null) => {
  const timestamp = new Date().toISOString();
  const status = error ? 'ERROR' : 'SUCCESS';
  const ln = getLineNum();
  console.log(`[KEYCLOAK-${status}] ${timestamp} ${method} ${endpoint} → ${statusCode} ${ln}`);
  if (data) {
    const summary = typeof data === 'string' ? data : JSON.stringify(data).substring(0, 150);
    console.log(`  └─ ${summary}`);
  }
  if (error) {
    console.error(`  └─ Error: ${error.message || error}`);
  }
};

/**
 * Resolve canonical user from User Service by identifier (email, phone, or username).
 * Returns canonical user identity.
 */
async function resolveCanonicalUser(identifier) {
  console.log(`[IAM] Resolving canonical user for ${maskIdentifier(identifier)} ${getLineNum()}`);
  
  let query;
  if (isEmail(identifier)) {
    query = `email=${encodeURIComponent(identifier)}&isEncrypted=false`;
  } else if (/^\d{10}$/.test(identifier)) {
    // Phone: 10 digits
    query = `phone=${encodeURIComponent(identifier)}&isEncrypted=false`;
  } else {
    // Username
    query = `username=${encodeURIComponent(identifier)}&isEncrypted=false`;
  }
  
  try {
    const resp = await axios.get(`${IAM_SERVICE_URL}/users?${query}`, { timeout: 15000 });
    const user = resp.data?.user || resp.data;
    
    if (!user || !user.id) {
      console.warn(`[IAM] No user found for ${maskIdentifier(identifier)} ${getLineNum()}`);
      return null;
    }
    
    const canonicalUser = {
      userId: user.id || user.userid,
      username: user.username,
      firstName: user.firstname || user.firstName,
      lastName: user.lastname || user.lastName,
      email: user.email,
      phone: user.phone || user.mobile,
      status: user.status
    };
    
    console.log(`[IAM] Resolved canonical user: userId=${canonicalUser.userId}, username=${canonicalUser.username} ${getLineNum()}`);
    return canonicalUser;
  } catch (err) {
    console.error(`[IAM] Error resolving canonical user ${getLineNum()}:`, err.response?.data || err.message);
    throw err;
  }
}

/**
 * Get a short-lived Keycloak admin token via service-account client_credentials.
 * Avoids hardcoding admin username/password in application code (requirement G).
 */
async function getAdminToken() {
  const endpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  try {
    console.log(`[KEYCLOAK-REQ] POST ${endpoint} (grant_type: client_credentials) ${getLineNum()}`);
    
    const resp = await axios.post(
      `${KEYCLOAK_URL}${endpoint}`,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     KC_ADMIN_CLIENT_ID,
        client_secret: KC_ADMIN_CLIENT_SECRET
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
        validateStatus: (s) => s < 500
      }
    );

    logKeycloakCall('POST', endpoint, resp.status, `access_token: ${resp.data.access_token ? 'granted' : 'null'}`);

    if (resp.status !== 200 || !resp.data.access_token) {
      throw new Error(
        `Failed to obtain service-account token: ${resp.status} ${JSON.stringify(resp.data)}`
      );
    }
    return resp.data.access_token;
  } catch (err) {
    logKeycloakCall('POST', endpoint, err.response?.status || 'TIMEOUT', null, err);
    throw err;
  }
}

/**
 * Create or idempotently update a Keycloak user from canonical IAM user.
 * Uses User Service username as Keycloak username.
 * Stores iamUserId and sunbirdUserId in attributes.
 * Returns the Keycloak user ID.
 */
async function upsertKeycloakUserFromIamUser(iamUser, adminToken) {
  const { userId, username, firstName, lastName, email, phone } = iamUser;
  
  const createEndpoint = `/admin/realms/${KEYCLOAK_REALM}/users`;
  
  try {
    // Step 1: Search for existing user by canonical username
    console.log(`[KEYCLOAK-REQ] GET ${createEndpoint}?username=${username}&exact=true ${getLineNum()}`);
    
    const searchResp = await axios.get(
      `${KEYCLOAK_URL}${createEndpoint}?username=${encodeURIComponent(username)}&exact=true`,
      { 
        headers: { 'Authorization': `Bearer ${adminToken}` }, 
        timeout: 10000,
        validateStatus: () => true 
      }
    );

    logKeycloakCall('GET', `${createEndpoint}?username=...`, searchResp.status, `Found ${searchResp.data?.length || 0} user(s)`);

    if (searchResp.status === 200 && searchResp.data?.length > 0) {
      // User exists – update attributes and requiredActions
      const existing = searchResp.data[0];
      const kcUserId = existing.id;
      
      console.log(`[KEYCLOAK] User exists: ${username} (${kcUserId}), updating attributes ${getLineNum()}`);
      
      // Ensure UPDATE_PASSWORD action, remove VERIFY_PROFILE and UPDATE_PROFILE (we populate names from user service)
      const actions = Array.from(
        new Set([
          ...(existing.requiredActions || []).filter(a => a !== 'VERIFY_PROFILE' && a !== 'UPDATE_PROFILE'),
          'UPDATE_PASSWORD'
        ])
      );
      
      const updatePayload = {
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        email: email || existing.email,
        enabled: true,
        emailVerified: true,
        requiredActions: actions,
        attributes: {
          iamUserId: [userId],
          sunbirdUserId: [userId],
          ...(phone && { phone: [phone] })
        }
      };
      
      console.log(`[KEYCLOAK-REQ] PUT ${createEndpoint}/${kcUserId} (update attributes) ${getLineNum()}`);
      
      const updateResp = await axios.put(
        `${KEYCLOAK_URL}${createEndpoint}/${kcUserId}`,
        updatePayload,
        {
          headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      logKeycloakCall('PUT', `${createEndpoint}/${kcUserId}`, updateResp.status, `User updated with actions: ${actions.join(', ')}`);
      
      return kcUserId;
    }

    // Step 2: User doesn't exist – create new
    console.log(`[KEYCLOAK-REQ] POST ${createEndpoint} (username: ${username}) ${getLineNum()}`);
    
    const userPayload = {
      username,
      enabled: true,
      firstName,
      lastName,
      ...(email && { email }),
      emailVerified: true,
      requiredActions: ['UPDATE_PASSWORD'],
      attributes: {
        iamUserId: [userId],
        sunbirdUserId: [userId],
        ...(phone && { phone: [phone] })
      }
    };
    
    const createResp = await axios.post(
      `${KEYCLOAK_URL}${createEndpoint}`,
      userPayload,
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: (s) => s < 500
      }
    );

    logKeycloakCall('POST', createEndpoint, createResp.status, `User creation attempt for ${username}`);

    if (createResp.status === 201) {
      const location = createResp.headers['location'] || '';
      const kcUserId = location.split('/').pop();
      console.log(`[KEYCLOAK] User created: ${username} (${kcUserId}) with iamUserId=${userId} ${getLineNum()}`);
      return kcUserId;
    }

    logKeycloakCall('POST', createEndpoint, createResp.status, `Unexpected response: ${JSON.stringify(createResp.data)}`);
    throw new Error(
      `Unexpected status ${createResp.status} creating Keycloak user: ${JSON.stringify(createResp.data)}`
    );
  } catch (err) {
    logKeycloakCall('POST/PUT', createEndpoint, err.response?.status || 'ERROR', null, err);
    throw err;
  }
}

/**
 * Generate a signed activation token.
 * Format: base64url(header).base64url(payload).base64url(HMAC-SHA256)
 * TTL: 10 minutes.  The Java authenticator validates this same format.
 */
function generateActivationToken({ identifier, keycloakUserId, iamUserId }) {
  const now    = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'activation' }))
                   .toString('base64url');
  const body   = Buffer.from(JSON.stringify({
    identifier, keycloakUserId, iamUserId,
    purpose: 'PASSWORD_ACTIVATION',
    iat: now,
    exp: now + 600
  })).toString('base64url');

  const sig = createHmac('sha256', ACTIVATION_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${sig}`;
}

/** Build Keycloak auth URL that includes the activation_token (for migrated users). */
function buildActivationAuthUrl({ state, nonce, codeChallenge, identifier,
                                   activationToken, redirectUri, clientId }) {
  const p = new URLSearchParams({
    client_id:             clientId || 'diksha-portal',
    response_type:         'code',
    scope:                 'openid profile email',
    state,
    nonce,
    redirect_uri:          redirectUri || FRONTEND_REDIRECT_URI,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    login_hint:            identifier,
    activation_token:      activationToken
  });
  return `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${p}`;
}

/** Build Keycloak auth URL for active users (normal PKCE login, no activation_token). */
function buildLoginAuthUrl({ state, nonce, codeChallenge, identifier, redirectUri, clientId }) {
  const p = new URLSearchParams({
    client_id:             clientId || 'diksha-portal',
    response_type:         'code',
    scope:                 'openid profile email',
    state,
    nonce,
    redirect_uri:          redirectUri || FRONTEND_REDIRECT_URI,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    login_hint:            identifier
  });
  return `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${p}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock OTP Service
// ──────────────────────────────────────────────────────────────────────────────
const mockOtpService = {
  send: async (id) => {
    const txnId = uuidv4();
    console.log(`[MOCK-OTP] Sent OTP ${MOCK_OTP_CODE} to ${maskIdentifier(id)}, txnId: ${txnId}`);
    return { 
      data: { 
        result: { 
          txnId, 
          response: 'SUCCESS' 
        } 
      } 
    };
  },
  generate: async (id) => {
    console.log(`[MOCK-OTP] Generated OTP ${MOCK_OTP_CODE} for ${maskIdentifier(id)}`);
    return { data: { params: { status: 'SUCCESS' }, result: { response: 'SUCCESS' } } };
  },
  verify: async (id, otp) => {
    if (otp === MOCK_OTP_CODE) {
      console.log(`[MOCK-OTP] Verified OTP for ${maskIdentifier(id)}`);
      return { data: { params: { status: 'SUCCESS' }, result: { response: 'SUCCESS' } } };
    }
    const err = new Error('OTP verification failed');
    err.response = {
      status: 400,
      data: {
        params: {
          err: 'OTP_VERIFICATION_FAILED', status: 'OTP_VERIFICATION_FAILED',
          errmsg: 'OTP verification failed. Remaining attempt count is 1.'
        },
        result: { remainingAttempt: 1, maxAllowedAttempt: 2 }
      }
    };
    throw err;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'iam-orchestrator' }));

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/login/start
// ──────────────────────────────────────────────────────────────────────────────
app.post('/iam/login/start', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) return res.status(400).json({ error: 'identifier is required' });
    
    console.log(`[LOGIN] /iam/login/start – identifier: ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 1: Resolve canonical user from identifier (email/phone/username) ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    console.log(`[LOGIN] Resolved canonical user: ${iamUserId} (username: ${iamUser.username}) ${getLineNum()}`);

    // ── STEP 2: Check activation status from mappingStore ──
    let mapping = null;
    let activationStatus = null;
    try {
      mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus;
      console.log(`[LOGIN] Activation status from mapping: ${activationStatus || 'not yet set'} ${getLineNum()}`);
    } catch (cacheErr) {
      console.warn(`[LOGIN] Mapping lookup failed ${getLineNum()}:`, cacheErr.message);
    }

    // ── ACTIVE user → Direct Grant (password authenticated server-side, no redirect) ──
    if (activationStatus === 'ACTIVE') {
      console.log(`[LOGIN] User is ACTIVE, attempting Direct Grant ${getLineNum()}`);

      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ flow: 'PASSWORD_REQUIRED', error: 'Password is required' });
      }

      const tokenEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      let tokenResp;
      try {
        console.log(`[KEYCLOAK-REQ] POST ${tokenEndpoint} (grant_type: password, username: ${iamUser.username}) ${getLineNum()}`);
        tokenResp = await axios.post(
          `${KEYCLOAK_URL}${tokenEndpoint}`,
          new URLSearchParams({
            grant_type: 'password',
            client_id:  KEYCLOAK_CLIENT_ID,
            username:   iamUser.username,
            password,
            scope:         'openid profile email'
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            validateStatus: s => s < 500
          }
        );
      } catch (err) {
        logKeycloakCall('POST', tokenEndpoint, err.response?.status || 'ERROR', null, err);
        return res.status(500).json({ error: 'Authentication service unavailable' });
      }

      logKeycloakCall('POST', tokenEndpoint, tokenResp.status, `access_token: ${tokenResp.data.access_token ? 'granted' : 'null'}`);

      if (tokenResp.status !== 200 || !tokenResp.data.access_token) {
        const kcError = tokenResp.data?.error_description || tokenResp.data?.error || 'Invalid credentials';
        return res.status(401).json({ error: kcError });
      }

      const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
      let idTokenPayload;
      try {
        idTokenPayload = validateTokenClaims(tokenResp.data.id_token, null, expectedIssuer, KEYCLOAK_CLIENT_ID);
        console.log(`[LOGIN] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`);
      } catch (validateErr) {
        console.error(`[LOGIN] Token validation failed ${getLineNum()}:`, validateErr.message);
        return res.status(401).json({ error: `Token validation failed: ${validateErr.message}` });
      }

      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          keycloakUserId: idTokenPayload.sub,
          username: iamUser.username,
          activationStatus: 'ACTIVE',
          updatedAt: Date.now()
        });
      } catch (mapErr) {
        console.warn(`[LOGIN] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      console.log(`[LOGIN] Direct Grant success for ${maskIdentifier(identifier)} ${getLineNum()}`);

      return res.json({
        flow: 'AUTHENTICATED',
        user: {
          id:        idTokenPayload.sub,
          username:  idTokenPayload.preferred_username,
          email:     idTokenPayload.email,
          name:      idTokenPayload.name,
          iamUserId: idTokenPayload.iamUserId || idTokenPayload.iam_user_id || iamUserId
        },
        tokens: {
          accessToken:  tokenResp.data.access_token,
          idToken:      tokenResp.data.id_token,
          refreshToken: tokenResp.data.refresh_token,
          expiresIn:    tokenResp.data.expires_in,
          tokenType:    tokenResp.data.token_type
        },
        roles:            idTokenPayload.realm_access?.roles || [],
        clientRoles:      idTokenPayload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || [],
        activationStatus: 'ACTIVE'
      });
    }

    // ── NEW, PASSWORD_SETUP_REQUIRED, or PASSWORD_SETUP_INITIATED user → initiate OTP flow ──
    // PASSWORD_SETUP_INITIATED means the user started but never completed password setup;
    // we allow them to restart the OTP flow rather than leaving them stuck.
    if (!activationStatus || activationStatus === 'PASSWORD_SETUP_REQUIRED' || activationStatus === 'PASSWORD_SETUP_INITIATED') {
      console.log(`[LOGIN] User status: ${activationStatus || 'NEW'}, initiating OTP flow ${getLineNum()}`);

      // Create/update Keycloak user with canonical username and IAM attributes
      let keycloakUserId;
      try {
        const adminToken = await getAdminToken();
        console.log(`[LOGIN] Obtained admin token, upserting Keycloak user ${getLineNum()}`);
        keycloakUserId = await upsertKeycloakUserFromIamUser(iamUser, adminToken);
        console.log(`[LOGIN] Keycloak user upserted: ${keycloakUserId} ${getLineNum()}`);
      } catch (kcErr) {
        console.error(`[LOGIN] Failed to upsert Keycloak user ${getLineNum()}:`, kcErr.message);
        return res.status(500).json({ error: 'Failed to prepare user account' });
      }

      // Update/create mapping for this user
      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          keycloakUserId,
          username: iamUser.username,
          activationStatus: activationStatus || 'PASSWORD_SETUP_REQUIRED',
          updatedAt: Date.now()
        });
        console.log(`[LOGIN] User mapping updated: ${iamUserId} → ${keycloakUserId} ${getLineNum()}`);
      } catch (mapErr) {
        console.warn(`[LOGIN] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      // Generate OTP
      let txnId, otpResp;
      try {
        const sendResp = USE_MOCK_OTP
          ? await mockOtpService.send(identifier)
          : await axios.post(
              `${IAM_SERVICE_URL}/otp/send`,
              { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone' } },
              { timeout: 5000 }
            );

        txnId = sendResp.data.result.txnId;
        otpResp = sendResp.data.result;

        console.log(`[LOGIN] OTP sent, txnId: ${txnId} ${getLineNum()}`);
      } catch (otpErr) {
        console.error(`[LOGIN] Failed to send OTP ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
        return res.status(500).json({ error: 'Failed to send OTP' });
      }

      // Store transaction data in Redis
      await txnStore.set(txnId, {
        identifier,
        iamUserId,
        keycloakUserId,
        txnId,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      console.log(`[LOGIN] Transaction stored: ${txnId} ${getLineNum()}`);

      return res.json({
        flow: 'OTP_VERIFICATION',
        txnId,
        otpResponse: otpResp
      });
    }

    return res.status(400).json({ error: 'Unable to determine user status' });

  } catch (err) {
    console.error(`[LOGIN] Error ${getLineNum()}:`, err.response?.data || err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/activation/verify-otp
// ──────────────────────────────────────────────────────────────────────────────
app.post('/iam/activation/verify-otp', async (req, res) => {
  try {
    const { txnId, otp } = req.body;

    if (!txnId || !otp) {
      return res.status(400).json({ error: 'txnId and otp are required' });
    }

    console.log(`[OTP] /iam/activation/verify-otp – txnId: ${txnId} ${getLineNum()}`);

    // ── STEP 1: Retrieve transaction data from Redis ──
    const txnData = await txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired transaction' });
    }

    const { identifier, iamUserId, keycloakUserId } = txnData;
    console.log(`[OTP] Transaction retrieved: identifier=${maskIdentifier(identifier)}, iamUserId=${iamUserId} ${getLineNum()}`);

    // ── STEP 2: Verify OTP ──
    try {
      const verifyResp = USE_MOCK_OTP
        ? await mockOtpService.verify(identifier, otp)
        : await axios.post(
            `${IAM_SERVICE_URL}/otp/verify`,
            { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone', otp } },
            { timeout: 10000 }
          );

      const st = verifyResp.data?.params?.status || verifyResp.data?.result?.response;
      if (st !== 'SUCCESS') return res.status(400).json({ error: 'OTP verification failed' });
    } catch (otpErr) {
      const data    = otpErr.response?.data;
      const errMsg  = data?.params?.errmsg || data?.message || 'OTP verification failed';
      const remaining = data?.result?.remainingAttempt;
      return res.status(400).json({ error: errMsg, ...(remaining != null && { remainingAttempts: remaining }) });
    }

    console.log(`[OTP] OTP verified for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 3: Generate PKCE and state (server-side) ──
    const { codeChallenge, codeVerifier } = generatePKCE();
    const state = uuidv4();
    const nonce = uuidv4();
    const redirectUri = FRONTEND_REDIRECT_URI;

    // ── STEP 4: Update mapping status to PASSWORD_SETUP_INITIATED ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        keycloakUserId,
        username: txnData.username || '',
        activationStatus: 'PASSWORD_SETUP_INITIATED',
        updatedAt: Date.now()
      });
      console.log(`[OTP] Mapping updated to PASSWORD_SETUP_INITIATED for ${iamUserId} ${getLineNum()}`);
    } catch (mapErr) {
      console.warn(`[OTP] Failed to update mapping ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 5: Store state with PKCE code_verifier (server-side only) ──
    await stateStore.set(state, {
      identifier,
      iamUserId,
      keycloakUserId,
      codeVerifier,
      nonce,
      activationStatus: 'PASSWORD_SETUP_INITIATED',
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[OTP] State stored with PKCE: ${state} ${getLineNum()}`);

    // ── STEP 6: Generate activation token and build Keycloak authorization URL ──
    // The activation token tells the custom Keycloak authenticator to skip the
    // login form and go directly to the UPDATE_PASSWORD required action page.
    const activationToken = generateActivationToken({ identifier, keycloakUserId, iamUserId });
    console.log(`[OTP] Generated activation token for ${maskIdentifier(identifier)} ${getLineNum()}`);

    const keycloakAuthUrl = buildActivationAuthUrl({
      state,
      nonce,
      codeChallenge,
      identifier,
      activationToken,
      redirectUri,
      clientId: KEYCLOAK_CLIENT_ID
    });

    console.log(`[OTP] Built activation authUrl for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 7: Clean up transaction and return response ──
    await txnStore.delete(txnId);

    const response = { 
      flow: 'SET_PASSWORD', 
      authUrl: keycloakAuthUrl, 
      state 
    };
    
    console.log(`[OTP] Returning activation response ${getLineNum()}`);
    return res.json(response);

  } catch (err) {
    console.error(`[OTP] Error ${getLineNum()}:`, err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/auth/callback
// Orchestrator-mediated authorization code exchange
// ──────────────────────────────────────────────────────────────────────────────
app.post('/iam/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ error: 'code and state are required' });
    }

    console.log(`[CALLBACK] /iam/auth/callback – state: ${state} ${getLineNum()}`);

    // ── STEP 1: Validate state and retrieve server-side PKCE data ──
    const stateData = await stateStore.get(state);
    if (!stateData || Date.now() > stateData.expiresAt) {
      console.warn(`[CALLBACK] Invalid or expired state: ${state} ${getLineNum()}`);
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    const { identifier, iamUserId, keycloakUserId, codeVerifier, nonce, activationStatus } = stateData;
    console.log(`[CALLBACK] State validated for ${maskIdentifier(identifier)}, iamUserId: ${iamUserId} ${getLineNum()}`);

    // ── STEP 2: Exchange authorization code with Keycloak using server-side code_verifier ──
    const tokenEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    console.log(`[KEYCLOAK-REQ] POST ${tokenEndpoint} (grant_type: authorization_code, code_verifier: [server-side]) ${getLineNum()}`);

    let tokenResp;
    try {
      tokenResp = await axios.post(
        `${KEYCLOAK_URL}${tokenEndpoint}`,
        new URLSearchParams({
          grant_type:   'authorization_code',
          client_id:    KEYCLOAK_CLIENT_ID,
          code,
          redirect_uri: FRONTEND_REDIRECT_URI,
          code_verifier: codeVerifier  // Use server-side stored verifier
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
    } catch (err) {
      console.error(`[CALLBACK] Token exchange failed ${getLineNum()}:`, err.response?.data || err.message);
      logKeycloakCall('POST', tokenEndpoint, err.response?.status || 'ERROR', null, err);
      return res.status(400).json({ error: 'Authorization failed. Code may be invalid or expired.' });
    }

    logKeycloakCall('POST', tokenEndpoint, tokenResp.status, `access_token: ${tokenResp.data.access_token ? 'granted' : 'null'}`);

    if (!tokenResp.data.access_token || !tokenResp.data.id_token) {
      console.error(`[CALLBACK] Missing tokens in response ${getLineNum()}`);
      return res.status(400).json({ error: 'Invalid token response from authorization server' });
    }

    // ── STEP 3: Validate ID token claims ──
    let idTokenPayload;
    const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
    try {
      idTokenPayload = validateTokenClaims(
        tokenResp.data.id_token,
        nonce,
        expectedIssuer,
        KEYCLOAK_CLIENT_ID
      );
      console.log(`[CALLBACK] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[CALLBACK] Token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(400).json({ error: `Token validation failed: ${validateErr.message}` });
    }

    let accessTokenPayload;
    try {
      accessTokenPayload = validateTokenClaims(
        tokenResp.data.access_token,
        null,  // no nonce in access token
        expectedIssuer,
        null   // some servers don't set aud in access token
      );
      console.log(`[CALLBACK] Access token validated ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[CALLBACK] Access token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(400).json({ error: `Access token validation failed: ${validateErr.message}` });
    }

    // ── STEP 4: Extract claims and user information from ID token ──
    const kcSubject = idTokenPayload.sub;
    const kcUsername = idTokenPayload.preferred_username;
    const kcEmail = idTokenPayload.email;
    const kcIamUserId = idTokenPayload.iamUserId || idTokenPayload.iam_user_id;
    const kcSunbirdUserId = idTokenPayload.sunbirdUserId || idTokenPayload.sunbird_user_id;

    console.log(`[CALLBACK] Keycloak user: subject=${kcSubject}, username=${kcUsername}, iamUserId=${kcIamUserId} ${getLineNum()}`);

    // ── STEP 5: Always mark mapping as ACTIVE after successful token exchange ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        keycloakUserId: kcSubject,
        username: kcUsername,
        activationStatus: 'ACTIVE',
        updatedAt: Date.now()
      });
      console.log(`[CALLBACK] Mapping status set to ACTIVE for ${maskIdentifier(identifier)} ${getLineNum()}`);
    } catch (updateErr) {
      console.warn(`[CALLBACK] Failed to update mapping ${getLineNum()}:`, updateErr.message);
    }

    // ── STEP 6: Build session response ──
    const sessionContext = {
      user: {
        id: kcSubject,
        username: kcUsername,
        email: kcEmail,
        name: idTokenPayload.name,
        iamUserId: kcIamUserId || iamUserId
      },
      tokens: {
        accessToken: tokenResp.data.access_token,
        idToken: tokenResp.data.id_token,
        refreshToken: tokenResp.data.refresh_token,
        expiresIn: tokenResp.data.expires_in,
        tokenType: tokenResp.data.token_type
      },
      roles: idTokenPayload.realm_access?.roles || [],
      clientRoles: idTokenPayload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || [],
      activationStatus
    };

    console.log(`[CALLBACK] Returning session context for ${maskIdentifier(identifier)} ${getLineNum()}`);
    
    // Clean up state store
    await stateStore.delete(state);

    return res.json(sessionContext);

  } catch (err) {
    console.error(`[CALLBACK] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /auth/token-exchange (DEPRECATED - kept for backwards compatibility)
// ──────────────────────────────────────────────────────────────────────────────
app.post('/auth/token-exchange', async (req, res) => {
  console.warn(`[TOKEN-EXCHANGE] Deprecated endpoint called. Use POST /iam/auth/callback instead ${getLineNum()}`);
  return res.status(410).json({ 
    error: 'This endpoint is deprecated. Use POST /iam/auth/callback instead.',
    hint: 'Frontend should send code and state to /iam/auth/callback, not this endpoint.'
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/me
// ──────────────────────────────────────────────────────────────────────────────
app.get('/iam/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(401).json({ error: 'Invalid token format' });

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch {
      return res.status(401).json({ error: 'Malformed token payload' });
    }

    console.log(`[ME] Token decoded, sub: ${payload.sub}, username: ${payload.preferred_username} ${getLineNum()}`);

    // ── STEP 1: Prefer iam_user_id or sunbird_user_id from claims (set by Keycloak mapper) ──
    let iamUserId = payload.iamUserId || payload.iam_user_id || payload.sunbirdUserId || payload.sunbird_user_id;
    let activationStatus = 'ACTIVE';

    // ── STEP 2: Resolve user information ──
    let userInfo = {
      id: payload.sub,
      email: payload.email,
      username: payload.preferred_username,
      name: payload.name,
      iamUserId,
      roles: payload.realm_access?.roles || [],
      clientRoles: payload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || []
    };

    // ── STEP 3: Get activation status from mapping if available ──
    if (iamUserId) {
      try {
        const mapping = await mappingStore.get(iamUserId);
        if (mapping) {
          activationStatus = mapping.activationStatus || 'ACTIVE';
          console.log(`[ME] Retrieved activation status from mapping: ${activationStatus} ${getLineNum()}`);
        }
      } catch (mapErr) {
        console.warn(`[ME] Failed to retrieve mapping ${getLineNum()}:`, mapErr.message);
      }
    }

    console.log(`[ME] Returning user info for ${payload.preferred_username}, iamUserId: ${iamUserId}, status: ${activationStatus} ${getLineNum()}`);

    return res.json({
      ...userInfo,
      activationStatus,
      keycloakClaims: payload
    });

  } catch (err) {
    console.error(`[ME] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/logout
// Revokes tokens with Keycloak and clears user session
// ──────────────────────────────────────────────────────────────────────────────
app.post('/iam/logout', async (req, res) => {
  try {
    const { refreshToken, iamUserId } = req.body;

    console.log(`[LOGOUT] /iam/logout – iamUserId: ${iamUserId ? maskIdentifier(iamUserId) : 'unknown'} ${getLineNum()}`);

    // ── STEP 1: Revoke refresh token with Keycloak ──
    if (refreshToken) {
      const revokeEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/revoke`;
      try {
        console.log(`[KEYCLOAK-REQ] POST ${revokeEndpoint} (revoke token) ${getLineNum()}`);
        
        const revokeResp = await axios.post(
          `${KEYCLOAK_URL}${revokeEndpoint}`,
          new URLSearchParams({
            client_id: KEYCLOAK_CLIENT_ID,
            token: refreshToken,
            token_type_hint: 'refresh_token'
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            validateStatus: (s) => s < 500
          }
        );

        logKeycloakCall('POST', revokeEndpoint, revokeResp.status, 'Token revocation attempt');

        if (revokeResp.status !== 200 && revokeResp.status !== 204) {
          console.warn(`[LOGOUT] Token revocation returned ${revokeResp.status} ${getLineNum()}`);
          // Continue logout even if token revocation fails
        }
      } catch (err) {
        console.warn(`[LOGOUT] Failed to revoke token ${getLineNum()}:`, err.message);
        // Continue logout even if token revocation fails
      }
    }

    // NOTE: We intentionally do NOT delete the mapping here.
    // The mapping stores the user's long-term activationStatus (ACTIVE, etc.)
    // and must persist across sessions so the next login uses Direct Grant
    // instead of restarting the OTP flow.
    if (iamUserId) {
      console.log(`[LOGOUT] Mapping preserved for ${maskIdentifier(iamUserId)} (activationStatus retained) ${getLineNum()}`);
    }

    console.log(`[LOGOUT] Logout successful ${getLineNum()}`);
    return res.json({ 
      status: 'logged_out',
      message: 'User logged out successfully'
    });

  } catch (err) {
    console.error(`[LOGOUT] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Initialize Redis and start server
initRedis().then(() => {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`IAM Orchestrator  http://0.0.0.0:${PORT}`);
    console.log(`Keycloak (int):   ${KEYCLOAK_URL}  (pub): ${KEYCLOAK_PUBLIC_URL}`);
    console.log(`IAM Service:      ${IAM_SERVICE_URL}`);
    console.log(`OTP mode:         ${USE_MOCK_OTP ? `MOCK (code: ${MOCK_OTP_CODE})` : 'REAL'}`);
    console.log(`Admin client:     ${KC_ADMIN_CLIENT_ID} (client_credentials)`);
    console.log(`Redis:            ${REDIS_URL}`);
    console.log(`${'='.repeat(60)}\n`);
  });
}).catch((err) => {
  console.error(`[STARTUP] Failed to initialize Redis ${getLineNum()}:`, err.message);
  process.exit(1);
});
