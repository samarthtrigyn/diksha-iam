import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHmac, randomBytes } from 'crypto';
import dotenv from 'dotenv';

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
// Shared secret for signing activation tokens (must match ACTIVATION_TOKEN_SECRET in Keycloak env)
const ACTIVATION_TOKEN_SECRET = process.env.ACTIVATION_TOKEN_SECRET || 'change-me-in-production';
// Mock OTP toggle
const USE_MOCK_OTP  = process.env.USE_MOCK_OTP  === 'true';
const MOCK_OTP_CODE = process.env.MOCK_OTP_CODE || '123456';
const FRONTEND_REDIRECT_URI = process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173/auth/callback';

// ──────────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true
}));
app.use(express.json());

// Log responses for debugging
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    if (req.path === '/iam/activation/verify-otp') {
      console.log('[RESPONSE] verify-otp response being sent:', JSON.stringify(data).substring(0, 200));
    }
    return originalJson.call(this, data);
  };
  next();
});

// ──────────────────────────────────────────────────────────────────────────────
// In-memory stores  (use Redis/DB in production)
// ──────────────────────────────────────────────────────────────────────────────
const txnStore       = new Map(); // txnId → { identifier, iamUserId, codeChallenge, ... }
const stateStore     = new Map(); // state  → { identifier, iamUserId, keycloakUserId, ... }
const migrationStore = new Map(); // identifier → { status, keycloakUserId, ... }

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const maskIdentifier = (id) =>
  isEmail(id)
    ? id.replace(/(.{2})[^@]*(@.*)/, '$1***$2')
    : id.replace(/(\d{2})\d*(\d{2})/, '$1****$2');

/**
 * Get a short-lived Keycloak admin token via service-account client_credentials.
 * Avoids hardcoding admin username/password in application code (requirement G).
 */
async function getAdminToken() {
  const resp = await axios.post(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
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

  if (resp.status !== 200 || !resp.data.access_token) {
    throw new Error(
      `Failed to obtain service-account token: ${resp.status} ${JSON.stringify(resp.data)}`
    );
  }
  return resp.data.access_token;
}

/**
 * Create or idempotently update a Keycloak user with UPDATE_PASSWORD required action.
 * Returns the Keycloak user ID.
 */
async function upsertKeycloakUser(identifier, adminToken) {
  // Derive a display name from the email local-part so Keycloak profile is
  // pre-filled and the VERIFY_PROFILE required action is never triggered.
  const localPart = isEmail(identifier) ? identifier.split('@')[0] : identifier;
  const nameParts = localPart.replace(/[._-]+/g, ' ').split(' ');
  const firstName = nameParts[0]?.charAt(0).toUpperCase() + nameParts[0]?.slice(1) || localPart;
  const lastName  = nameParts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || '-';

  const userPayload = {
    username:        identifier,
    email:           isEmail(identifier) ? identifier : undefined,
    firstName,
    lastName,
    enabled:         true,
    emailVerified:   true,
    // Only UPDATE_PASSWORD — explicitly exclude VERIFY_PROFILE
    requiredActions: ['UPDATE_PASSWORD']
  };

  const createResp = await axios.post(
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
    userPayload,
    {
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: (s) => s < 500
    }
  );

  if (createResp.status === 201) {
    // Extract new user ID from Location header  …/users/{id}
    const location = createResp.headers['location'] || '';
    const kcUserId = location.split('/').pop();
    console.log(`[KEYCLOAK] User created: ${maskIdentifier(identifier)} (${kcUserId})`);
    return kcUserId;
  }

  if (createResp.status === 409) {
    // User already exists – set UPDATE_PASSWORD and clear VERIFY_PROFILE
    const searchResp = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users?` +
      `username=${encodeURIComponent(identifier)}&exact=true`,
      { headers: { 'Authorization': `Bearer ${adminToken}` }, timeout: 10000 }
    );

    const existing = searchResp.data?.[0];
    if (!existing) throw new Error(`User ${maskIdentifier(identifier)} not found after 409`);

    const kcUserId = existing.id;
    // Keep existing actions but remove VERIFY_PROFILE, ensure UPDATE_PASSWORD present
    const actions = Array.from(
      new Set([
        ...(existing.requiredActions || []).filter(a => a !== 'VERIFY_PROFILE'),
        'UPDATE_PASSWORD'
      ])
    );

    await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${kcUserId}`,
      {
        firstName: existing.firstName || firstName,
        lastName:  existing.lastName  || lastName,
        requiredActions: actions,
        enabled:         true,
        emailVerified:   true
      },
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    console.log(`[KEYCLOAK] Existing user ${maskIdentifier(identifier)} updated with UPDATE_PASSWORD (${kcUserId})`);
    return kcUserId;
  }

  throw new Error(
    `Unexpected status ${createResp.status} creating Keycloak user: ` +
    JSON.stringify(createResp.data)
  );
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
    const { identifier, codeChallenge, redirectUri, clientId } = req.body;

    if (!identifier) return res.status(400).json({ error: 'identifier is required' });
    
    // codeChallenge should be provided by PKCE-enabled clients, but make it optional for backward compatibility
    if (!codeChallenge) {
      console.warn(`[LOGIN] codeChallenge missing for ${maskIdentifier(identifier)} - PKCE will not be enforced`);
    }

    console.log(`[LOGIN] /iam/login/start – ${maskIdentifier(identifier)}`);

    // Look up user in IAM service
    const query = isEmail(identifier)
      ? `email=${encodeURIComponent(identifier)}&isEncrypted=false`
      : `phone=${encodeURIComponent(identifier)}&isEncrypted=false`;

    const iamResp = await axios.get(`${IAM_SERVICE_URL}/users?${query}`, { timeout: 5000 });
    const iamUser = iamResp.data?.user || iamResp.data;
    const iamUserId = iamUser.userId || iamUser.id;

    // Resolve effective migration status
    const cached          = migrationStore.get(identifier);
    const effectiveStatus = cached?.status || iamUser.activationStatus || 'LEGACY_ONLY';

    console.log(`[LOGIN] ${maskIdentifier(identifier)} effectiveStatus=${effectiveStatus}`);

    if (effectiveStatus === 'BLOCKED') {
      return res.status(403).json({ error: 'Account blocked. Please contact support.' });
    }

    // ── ACTIVE user → direct Keycloak PKCE login ──
    if (effectiveStatus === 'ACTIVE') {
      const state = uuidv4();
      const nonce = randomBytes(16).toString('hex');
      stateStore.set(state, { identifier, iamUserId, expiresAt: Date.now() + 600_000 });

      const authUrl = buildLoginAuthUrl({
        state, nonce, codeChallenge,
        identifier,
        redirectUri: redirectUri || FRONTEND_REDIRECT_URI,
        clientId
      });

      return res.json({ nextAction: 'KEYCLOAK_LOGIN', authUrl, state });
    }

    // ── Non-active → send OTP ──
    try {
      const otpResp = USE_MOCK_OTP
        ? await mockOtpService.generate(identifier)
        : await axios.post(
            `${IAM_SERVICE_URL}/otp/generate`,
            { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone' } },
            { timeout: 10000 }
          );

      const otpStatus = otpResp.data?.params?.status || otpResp.data?.result?.response;
      if (otpStatus !== 'SUCCESS') return res.status(500).json({ error: 'Failed to generate OTP' });

      const txnId = uuidv4();
      txnStore.set(txnId, {
        identifier, iamUserId,
        codeChallenge,
        redirectUri: redirectUri || FRONTEND_REDIRECT_URI,
        clientId,
        expiresAt: Date.now() + 600_000
      });

      console.log(`[LOGIN] OTP generated, txnId: ${txnId}`);
      return res.json({ nextAction: 'VERIFY_OTP', txnId, maskedIdentifier: maskIdentifier(identifier) });

    } catch (otpErr) {
      if (otpErr.response?.status === 429) {
        return res.status(429).json({ error: 'Too many OTP requests. Please wait and try again.' });
      }
      throw otpErr;
    }

  } catch (err) {
    console.error('[LOGIN] Error:', err.response?.data || err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/activation/verify-otp
// ──────────────────────────────────────────────────────────────────────────────
app.post('/iam/activation/verify-otp', async (req, res) => {
  try {
    const { txnId, identifier, otp, codeChallenge } = req.body;

    if (!txnId || !identifier || !otp || !codeChallenge) {
      return res.status(400).json({ error: 'txnId, identifier, otp and codeChallenge are required' });
    }

    console.log(`[OTP] /iam/activation/verify-otp – txnId: ${txnId}`);

    const txnData = txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired transaction' });
    }

    // ── Verify OTP ──
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

    console.log(`[OTP] OTP verified for ${maskIdentifier(identifier)}`);

    // ── Create / link Keycloak user (idempotent, sets UPDATE_PASSWORD) ──
    let keycloakUserId;
    try {
      const adminToken = await getAdminToken();
      keycloakUserId   = await upsertKeycloakUser(identifier, adminToken);
    } catch (kcErr) {
      console.error('[KEYCLOAK] Error:', kcErr.message);
      return res.status(500).json({ error: 'Failed to provision Keycloak account' });
    }

    // ── Update migration status ──
    migrationStore.set(identifier, {
      status: 'PASSWORD_SETUP_INITIATED',
      keycloakUserId,
      iamUserId: txnData.iamUserId,
      updatedAt: Date.now()
    });

    // ── Generate state, nonce, and short-lived activation token ──
    const state           = uuidv4();
    const nonce           = randomBytes(16).toString('hex');
    const activationToken = generateActivationToken({ identifier, keycloakUserId, iamUserId: txnData.iamUserId });

    const finalCodeChallenge = codeChallenge || txnData.codeChallenge;
    const finalRedirectUri   = txnData.redirectUri || FRONTEND_REDIRECT_URI;
    const finalClientId      = txnData.clientId;

    stateStore.set(state, {
      identifier,
      iamUserId:      txnData.iamUserId,
      keycloakUserId,
      migrationStatus: 'PASSWORD_SETUP_INITIATED',
      expiresAt:      Date.now() + 600_000
    });

    // Build the Keycloak authorization URL containing the activation_token.
    // The custom Keycloak authenticator will read this, validate it, set the user,
    // and call context.success() → Keycloak shows the Update Password page directly.
    const authUrl = buildActivationAuthUrl({
      state, nonce,
      codeChallenge:  finalCodeChallenge,
      identifier,
      activationToken,
      redirectUri:    finalRedirectUri,
      clientId:       finalClientId
    });

    console.log(`[OTP] Built activation authUrl for ${maskIdentifier(identifier)}`);
    console.log(`[OTP] authUrl: ${authUrl}`);

    txnStore.delete(txnId);

    const response = { nextAction: 'SET_PASSWORD', authUrl, state };
    console.log(`[OTP] Returning response:`, {
      nextAction: response.nextAction,
      hasAuthUrl: !!response.authUrl,
      authUrlLength: response.authUrl?.length,
      state: response.state
    });
    
    res.setHeader('Content-Type', 'application/json');
    return res.json(response);

  } catch (err) {
    console.error('[OTP] Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /auth/token-exchange
// ──────────────────────────────────────────────────────────────────────────────
app.post('/auth/token-exchange', async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri, clientId } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code and redirectUri are required' });
    }

    const tokenResp = await axios.post(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type:   'authorization_code',
        client_id:    clientId || 'diksha-portal',
        code,
        redirect_uri: redirectUri,
        ...(codeVerifier && { code_verifier: codeVerifier })
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );

    return res.json(tokenResp.data);
  } catch (err) {
    console.error('[TOKEN] Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Token exchange failed' });
  }
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

    const identifier = payload.email || payload.preferred_username;

    // If the user just completed password setup, mark them ACTIVE
    const migration = migrationStore.get(identifier);
    if (migration?.status === 'PASSWORD_SETUP_INITIATED') {
      migrationStore.set(identifier, { ...migration, status: 'ACTIVE', updatedAt: Date.now() });
      console.log(`[ME] ${maskIdentifier(identifier)} → ACTIVE`);
    }

    return res.json({
      id:              payload.sub,
      email:           payload.email,
      username:        payload.preferred_username,
      name:            payload.name,
      roles:           payload.realm_access?.roles || [],
      migrationStatus: migrationStore.get(identifier)?.status || 'ACTIVE',
      keycloakClaims:  payload
    });
  } catch (err) {
    console.error('[ME] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`IAM Orchestrator  http://0.0.0.0:${PORT}`);
  console.log(`Keycloak (int):   ${KEYCLOAK_URL}  (pub): ${KEYCLOAK_PUBLIC_URL}`);
  console.log(`IAM Service:      ${IAM_SERVICE_URL}`);
  console.log(`OTP mode:         ${USE_MOCK_OTP ? `MOCK (code: ${MOCK_OTP_CODE})` : 'REAL'}`);
  console.log(`Admin client:     ${KC_ADMIN_CLIENT_ID} (client_credentials)`);
  console.log(`${'='.repeat(60)}\n`);
});
