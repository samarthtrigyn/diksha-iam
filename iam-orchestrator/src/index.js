import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Configuration
const IAM_SERVICE_URL = process.env.IAM_USER_SERVICE_URL || 'http://iam-service:3000';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'diksha-demo';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'iam-admin-client';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'iam-admin-client-secret';

// Middleware
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true
}));
app.use(express.json());

// In-memory stores
const txnStore = new Map(); // Store transaction state
const stateStore = new Map(); // Store OAuth state

// Utility functions
const isEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);

const maskIdentifier = (identifier) => {
  if (isEmail(identifier)) {
    return identifier.replace(/(.{2})[^@]*(@.*)/, '$1***$2');
  }
  return identifier.replace(/(\d{2})\d*(\d{2})/, '$1****$2');
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'iam-orchestrator' });
});

// ===== POST /iam/login/start =====
// Initiates login: looks up user in IAM service and generates OTP
app.post('/iam/login/start', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json({ error: 'Identifier is required' });
    }

    console.log(`[LOGIN] /iam/login/start - identifier: ${identifier}`);

    // Look up user in IAM service
    const query = isEmail(identifier) ? `email=${identifier}` : `phone=${identifier}`;
    const response = await axios.get(
      `${IAM_SERVICE_URL}/users?${query}`,
      { timeout: 5000 }
    );

    const user = response.data;
    console.log(`[LOGIN] User found: ${user.id}, status: ${user.activationStatus}`);

    // If user is already active, return keycloak login URL
    if (user.activationStatus === 'ACTIVE') {
      const state = uuidv4();
      stateStore.set(state, { identifier, expiresAt: Date.now() + 600000 });

      const authUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?` +
        `client_id=diksha-portal&response_type=code&scope=openid profile email&state=${state}&` +
        `redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}`;

      return res.json({
        nextAction: 'KEYCLOAK_LOGIN',
        authUrl,
        state
      });
    }

    // User needs OTP verification
    try {
      const otpResponse = await axios.post(
        `${IAM_SERVICE_URL}/otp/generate`,
        { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone' } },
        { timeout: 5000 }
      );

      const iamTxnId = otpResponse.data?.result?.txnId;
      if (!iamTxnId) {
        return res.status(500).json({ error: 'Failed to generate OTP' });
      }

      // Store transaction data
      txnStore.set(iamTxnId, {
        identifier,
        userId: user.id,
        expiresAt: Date.now() + 600000
      });

      console.log(`[LOGIN] OTP generated, txnId: ${iamTxnId}`);

      res.json({
        nextAction: 'VERIFY_OTP',
        txnId: iamTxnId,
        maskedIdentifier: maskIdentifier(identifier)
      });
    } catch (error) {
      console.error('[LOGIN] OTP generation failed:', error.message);
      res.status(500).json({ error: 'Failed to generate OTP' });
    }
  } catch (error) {
    console.error('[LOGIN] Error:', error.message);
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== POST /iam/activation/verify-otp =====
// Verifies OTP and creates/updates Keycloak user
app.post('/iam/activation/verify-otp', async (req, res) => {
  try {
    const { txnId, identifier, otp, codeChallenge } = req.body;

    if (!txnId || !identifier || !otp || !codeChallenge) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[OTP] /iam/activation/verify-otp - txnId: ${txnId}, identifier: ${identifier}`);

    // Validate transaction
    const txnData = txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired transaction' });
    }

    // Verify OTP with IAM service
    try {
      const verifyResponse = await axios.post(
        `${IAM_SERVICE_URL}/otp/verify`,
        {
          request: {
            txnId,
            otp,
            key: identifier,
            type: isEmail(identifier) ? 'email' : 'phone'
          }
        },
        { timeout: 5000 }
      );

      if (!verifyResponse.data?.result?.response?.verified) {
        return res.status(400).json({ error: 'OTP verification failed' });
      }

      const iamUser = verifyResponse.data.result.response.user;
      console.log(`[OTP] OTP verified for user: ${iamUser.id}`);

      // For now, just return success with Keycloak auth URL
      // In production, would create/update Keycloak user here
      const state = uuidv4();
      stateStore.set(state, {
        identifier,
        userId: iamUser.id,
        expiresAt: Date.now() + 600000
      });

      const authUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?` +
        `client_id=diksha-portal&response_type=code&scope=openid profile email&state=${state}&` +
        `redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&` +
        `code_challenge=${codeChallenge}&code_challenge_method=S256`;

      // Clean up transaction
      txnStore.delete(txnId);

      res.json({
        nextAction: 'KEYCLOAK_LOGIN',
        authUrl,
        state,
        user: {
          id: iamUser.id,
          email: iamUser.email,
          phone: iamUser.phone
        }
      });
    } catch (error) {
      console.error('[OTP] Verification error:', error.message);
      res.status(400).json({ error: 'OTP verification failed' });
    }
  } catch (error) {
    console.error('[OTP] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== GET /iam/me =====
// Returns user profile and Keycloak claims from JWT
app.get('/iam/me', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    // Decode JWT (without verification for demo)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    res.json({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      roles: payload.realm_access?.roles || [],
      organizations: payload.org || [],
      keycloakClaims: payload
    });
  } catch (error) {
    console.error('[ME] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== GET /iam/keycloak-login-url =====
// Returns Keycloak login URL for direct authentication
app.get('/iam/keycloak-login-url', (req, res) => {
  try {
    const state = uuidv4();
    const codeChallenge = req.query.code_challenge || '';

    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?` +
      `client_id=diksha-portal&response_type=code&scope=openid profile email&state=${state}&` +
      `redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}` +
      (codeChallenge ? `&code_challenge=${codeChallenge}&code_challenge_method=S256` : '');

    stateStore.set(state, {
      expiresAt: Date.now() + 600000
    });

    res.json({ url, state });
  } catch (error) {
    console.error('[KEYCLOAK-LOGIN-URL] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== POST /auth/token-exchange =====
// Exchange authorization code for tokens
app.post('/auth/token-exchange', async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[TOKEN] Exchanging code for tokens`);

    // Exchange code with Keycloak
    const tokenResponse = await axios.post(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        grant_type: 'authorization_code',
        client_id: 'diksha-portal',
        code,
        redirect_uri: redirectUri,
        ...(codeVerifier && { code_verifier: codeVerifier })
      },
      { timeout: 5000 }
    );

    res.json(tokenResponse.data);
  } catch (error) {
    console.error('[TOKEN] Error:', error.message);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`IAM Orchestrator running on http://0.0.0.0:${PORT}`);
  console.log(`Keycloak: ${KEYCLOAK_URL}`);
  console.log(`IAM Service: ${IAM_SERVICE_URL}`);
  console.log(`${'='.repeat(60)}\n`);
});
