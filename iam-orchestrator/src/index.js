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
// Public-facing Keycloak URL for browser redirects (may differ from internal Docker URL)
const KEYCLOAK_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'diksha-demo';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'iam-admin-client';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'iam-admin-client-secret';
const USE_MOCK_OTP = process.env.USE_MOCK_OTP === 'true'; // Enable mock OTP for testing
const MOCK_OTP_CODE = process.env.MOCK_OTP_CODE || '123456'; // Mock OTP code for testing

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

// Mock OTP Service (for testing without rate limits)
const mockOtpService = {
  generate: async (identifier) => {
    console.log(`[MOCK-OTP] Generated OTP for ${identifier}: ${MOCK_OTP_CODE}`);
    return {
      data: {
        params: { status: 'SUCCESS' },
        result: { response: 'SUCCESS' }
      }
    };
  },
  
  verify: async (identifier, otp) => {
    if (otp === MOCK_OTP_CODE) {
      console.log(`[MOCK-OTP] Verified OTP for ${identifier}`);
      return {
        data: {
          params: { status: 'SUCCESS' },
          result: { response: 'SUCCESS' }
        }
      };
    }
    // Simulate wrong OTP response
    const error = new Error('OTP verification failed');
    error.response = {
      status: 400,
      data: {
        params: {
          err: 'OTP_VERIFICATION_FAILED',
          status: 'OTP_VERIFICATION_FAILED',
          errmsg: `OTP verification failed. Remaining attempt count is 1.`
        },
        result: { remainingAttempt: 1, maxAllowedAttempt: 2 }
      }
    };
    throw error;
  }
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
    const query = isEmail(identifier)
      ? `email=${encodeURIComponent(identifier)}&isEncrypted=false`
      : `phone=${encodeURIComponent(identifier)}&isEncrypted=false`;
    const response = await axios.get(
      `${IAM_SERVICE_URL}/users?${query}`,
      { timeout: 5000 }
    );

    // Real IAM service wraps the user in { user: {...} }
    const user = response.data?.user || response.data;
    console.log(`[LOGIN] User found: ${user.userId || user.id}, status: ${user.activationStatus}`);

    // If user is already active, return keycloak login URL
    if (user.activationStatus === 'ACTIVE') {
      const state = uuidv4();
      stateStore.set(state, { identifier, expiresAt: Date.now() + 600000 });

      const authUrl = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?` +
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
      let otpResponse;
      
      if (USE_MOCK_OTP) {
        // Use mock OTP service
        otpResponse = await mockOtpService.generate(identifier);
      } else {
        // Call real IAM service for OTP generation
        otpResponse = await axios.post(
          `${IAM_SERVICE_URL}/otp/generate`,
          { request: { key: identifier, type: isEmail(identifier) ? 'email' : 'phone' } },
          { timeout: 10000 }
        );
      }

      // Real IAM service returns { result: { response: 'SUCCESS' } } — no txnId
      const status = otpResponse.data?.params?.status || otpResponse.data?.result?.response;
      if (status !== 'SUCCESS') {
        return res.status(500).json({ error: 'Failed to generate OTP' });
      }

      // Generate our own txnId to track this session
      const txnId = uuidv4();
      txnStore.set(txnId, {
        identifier,
        userId: user.id,
        expiresAt: Date.now() + 600000
      });

      console.log(`[LOGIN] OTP generated for ${identifier}, txnId: ${txnId}`);

      res.json({
        nextAction: 'VERIFY_OTP',
        txnId,
        maskedIdentifier: maskIdentifier(identifier)
      });
    } catch (error) {
      console.error('[LOGIN] OTP generation failed:', error.message);
      if (error.response?.status === 429) {
        return res.status(429).json({ error: 'Too many OTP requests. Please wait a few minutes and try again.' });
      }
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

    // Verify OTP with real IAM service — expects {key, type, otp}
    try {
      let verifyResponse;
      
      if (USE_MOCK_OTP) {
        // Use mock OTP service
        verifyResponse = await mockOtpService.verify(identifier, otp);
      } else {
        // Call real IAM service for OTP verification
        verifyResponse = await axios.post(
          `${IAM_SERVICE_URL}/otp/verify`,
          {
            request: {
              key: identifier,
              type: isEmail(identifier) ? 'email' : 'phone',
              otp
            }
          },
          { timeout: 10000 }
        );
      }

      // Real service returns { params: { status: 'SUCCESS' } } on success
      const status = verifyResponse.data?.params?.status || verifyResponse.data?.result?.response;
      if (status !== 'SUCCESS') {
        return res.status(400).json({ error: 'OTP verification failed' });
      }

      console.log(`[OTP] OTP verified for: ${identifier}`);

      // Create user in Keycloak after OTP verification
      try {
        const keycloakUser = {
          email: isEmail(identifier) ? identifier : undefined,
          username: identifier,
          enabled: true,
          emailVerified: true,
          requiredActions: ['UPDATE_PASSWORD'] // Force password change on first login
        };

        // Get Keycloak admin token using admin-cli client (has full permissions)
        const adminTokenResponse = await axios.post(
          `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
          new URLSearchParams({
            client_id: 'admin-cli',
            grant_type: 'password',
            username: 'admin',
            password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_password'
          }).toString(),
          { 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
            timeout: 10000,
            validateStatus: (status) => status < 500
          }
        );

        if (adminTokenResponse.status !== 200) {
          throw new Error(`Failed to get admin token: ${adminTokenResponse.status} ${adminTokenResponse.data?.error}`);
        }

        const adminToken = adminTokenResponse.data.access_token;

        // Create user in Keycloak
        const createUserResponse = await axios.post(
          `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
          keycloakUser,
          {
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000,
            validateStatus: (status) => status < 500 // Allow 409 (user exists)
          }
        );

        if (createUserResponse.status === 201) {
          console.log(`[KEYCLOAK] User created: ${identifier}`);
        } else if (createUserResponse.status === 409) {
          console.log(`[KEYCLOAK] User already exists: ${identifier}, updating required actions...`);
          
          // User exists, need to find and update it
          const usersResponse = await axios.get(
            `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users?username=${encodeURIComponent(identifier)}`,
            {
              headers: { 'Authorization': `Bearer ${adminToken}` },
              timeout: 10000
            }
          );
          
          if (usersResponse.data && usersResponse.data.length > 0) {
            const userId = usersResponse.data[0].id;
            
            // Update user to require password change
            const updateResponse = await axios.put(
              `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
              {
                requiredActions: ['UPDATE_PASSWORD'],
                emailVerified: true,
                enabled: true
              },
              {
                headers: {
                  'Authorization': `Bearer ${adminToken}`,
                  'Content-Type': 'application/json'
                },
                timeout: 10000
              }
            );
            
            console.log(`[KEYCLOAK] Updated user ${identifier} to require password change`);
          }
        } else {
          console.warn(`[KEYCLOAK] Unexpected status creating user: ${createUserResponse.status} - ${createUserResponse.data?.errorMessage}`);
        }
      } catch (kcError) {
        console.error('[KEYCLOAK] Error creating/updating user:', kcError.message);
        // Don't fail OTP verification if Keycloak user creation fails, continue with login
      }

      // For new users, send them to our custom password setup form
      // instead of direct Keycloak auth (which expects them to already have credentials)
      // The frontend will show a password creation form and then initiate the OAuth flow
      const setupToken = uuidv4();
      stateStore.set(`setup_${setupToken}`, {
        identifier,
        userId: txnData.userId,
        codeChallenge,
        state: uuidv4(),
        expiresAt: Date.now() + 600000
      });

      // Return a setup URL that will be handled by the frontend
      const setupUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/setup-password?token=${setupToken}`;

      // Clean up transaction
      txnStore.delete(txnId);

      res.json({
        nextAction: 'SET_PASSWORD',
        setupUrl,
        setupToken
      });
    } catch (error) {
      console.error('[OTP] Verification error:', error.response?.data || error.message);
      const data = error.response?.data;
      // Real IAM service returns { params: { errmsg, err }, result: { remainingAttempt } }
      const errMsg = data?.params?.errmsg || data?.message || 'OTP verification failed';
      const remaining = data?.result?.remainingAttempt;
      return res.status(400).json({
        error: errMsg,
        ...(remaining != null && { remainingAttempts: remaining })
      });
    }
  } catch (error) {
    console.error('[OTP] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== POST /auth/set-password =====
// Set password for newly created users and get Keycloak auth code
app.post('/auth/set-password', async (req, res) => {
  try {
    const { setupToken, password, codeChallenge } = req.body;

    if (!setupToken || !password || !codeChallenge) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[SET-PASSWORD] Setting password using setup token`);

    // Validate setup token
    const setupData = stateStore.get(`setup_${setupToken}`);
    if (!setupData || Date.now() > setupData.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired setup token' });
    }

    const { identifier, userId } = setupData;

    // Get Keycloak admin token
    const adminTokenResponse = await axios.post(
      `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
      new URLSearchParams({
        client_id: 'admin-cli',
        grant_type: 'password',
        username: 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin_password'
      }).toString(),
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
        timeout: 10000,
        validateStatus: (status) => status < 500
      }
    );

    if (adminTokenResponse.status !== 200) {
      throw new Error(`Failed to get admin token: ${adminTokenResponse.status}`);
    }

    const adminToken = adminTokenResponse.data.access_token;

    // Find user and set password
    const usersResponse = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users?username=${encodeURIComponent(identifier)}`,
      {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        timeout: 10000
      }
    );

    if (!usersResponse.data || usersResponse.data.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const keycloakUserId = usersResponse.data[0].id;

    // Set password using admin API
    const setPasswordResponse = await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}/reset-password`,
      {
        type: 'password',
        value: password,
        temporary: false // Not temporary - user just set it
      },
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(`[SET-PASSWORD] Password set for user: ${identifier}`);

    // Clear required actions since password is now set
    const updateUserResponse = await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}`,
      {
        requiredActions: [] // Clear required actions after password setup
      },
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // Now generate auth code by initiating internal authentication
    // We'll return the auth URL so the frontend can proceed with the OAuth flow
    const state = uuidv4();
    stateStore.set(state, {
      identifier,
      userId,
      expiresAt: Date.now() + 600000
    });

    const authUrl = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?` +
      `client_id=diksha-portal&response_type=code&scope=openid+profile+email&state=${state}&` +
      `redirect_uri=${encodeURIComponent(process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173/auth/callback')}&` +
      `code_challenge=${codeChallenge}&code_challenge_method=S256&` +
      `login_hint=${encodeURIComponent(identifier)}`;

    // Clean up setup token
    stateStore.delete(`setup_${setupToken}`);

    res.json({
      nextAction: 'KEYCLOAK_LOGIN',
      authUrl,
      state
    });
  } catch (error) {
    console.error('[SET-PASSWORD] Error:', error.message);
    res.status(500).json({ error: 'Failed to set password' });
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
  console.log(`OTP Service: ${USE_MOCK_OTP ? `MOCK (code: ${MOCK_OTP_CODE})` : 'REAL'}`);
  console.log(`${'='.repeat(60)}\n`);
});
