import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS Configuration
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  credentials: true
}));

app.use(express.json());

// ===== Configuration =====
const IAM_USER_SERVICE_URL = process.env.IAM_USER_SERVICE_URL || 'http://iam-service:3000';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'diksha-demo';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'iam-admin-client';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'iam-admin-client-secret';
const FRONTEND_REDIRECT_URI = process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173/auth/callback';
const STATE_STORE_TTL = parseInt(process.env.STATE_STORE_TTL || '600000', 10);

// ===== In-Memory State Management =====
const stateStore = new Map();
const txnIdStore = new Map();

// Clean up expired state
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of stateStore) {
    if (value.expiresAt < now) {
      stateStore.delete(key);
    }
  }
  for (const [key, value] of txnIdStore) {
    if (value.expiresAt < now) {
      txnIdStore.delete(key);
    }
  }
}, 60000); // Check every minute

// ===== Keycloak Admin API =====
class KeycloakAdmin {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
        {
          client_id: KEYCLOAK_CLIENT_ID,
          client_secret: KEYCLOAK_CLIENT_SECRET,
          grant_type: 'client_credentials'
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt = now + (response.data.expires_in * 1000) - 10000; // Refresh 10s before expiry
      return this.accessToken;
    } catch (error) {
      console.error('Failed to get Keycloak admin token:', error.message);
      throw error;
    }
  }

  async findUserByEmail(email) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.get(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users?email=${email}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      console.error(`Failed to find user by email: ${email}`, error.message);
      return null;
    }
  }

  async findUserByUsername(username) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.get(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users?username=${username}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      console.error(`Failed to find user by username: ${username}`, error.message);
      return null;
    }
  }

  async createUser(userData) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.post(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
        userData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Extract user ID from location header
      const userId = response.headers['location']?.split('/').pop();
      return userId;
    } catch (error) {
      console.error('Failed to create Keycloak user:', error.response?.data || error.message);
      throw error;
    }
  }

  async updateUser(userId, userData) {
    const token = await this.getAccessToken();
    try {
      await axios.put(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
        userData,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return true;
    } catch (error) {
      console.error(`Failed to update Keycloak user: ${userId}`, error.message);
      throw error;
    }
  }

  async assignRoleToUser(userId, role) {
    const token = await this.getAccessToken();
    try {
      // First get the role
      const roleResponse = await axios.get(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/roles/${role}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const roleData = roleResponse.data;

      // Assign role to user
      await axios.post(
        `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
        [roleData],
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return true;
    } catch (error) {
      console.error(`Failed to assign role ${role} to user ${userId}:`, error.message);
      throw error;
    }
  }
}

const keycloakAdmin = new KeycloakAdmin();

// ===== IAM User Service =====
class IamUserService {
  async findUserByEmail(email) {
    try {
      const response = await axios.get(
        `${IAM_USER_SERVICE_URL}/users?email=${email}&isEncrypted=false`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to find user by email in IAM service: ${email}`, error.message);
      return null;
    }
  }

  async findUserByPhone(phone) {
    try {
      const response = await axios.get(
        `${IAM_USER_SERVICE_URL}/users?phone=${phone}&isEncrypted=false`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to find user by phone in IAM service: ${phone}`, error.message);
      return null;
    }
  }

  async getUserById(userId) {
    try {
      const response = await axios.get(
        `${IAM_USER_SERVICE_URL}/users/${userId}`,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to find user by ID in IAM service: ${userId}`, error.message);
      return null;
    }
  }

  async generateOtp(identifier, type) {
    try {
      const response = await axios.post(
        `${IAM_USER_SERVICE_URL}/otp/generate`,
        {
          request: {
            key: identifier,
            type: type // 'email' or 'phone'
          }
        },
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to generate OTP for ${identifier}:`, error.message);
      throw error;
    }
  }

  async verifyOtp(identifier, type, otp) {
    try {
      const response = await axios.post(
        `${IAM_USER_SERVICE_URL}/otp/verify`,
        {
          request: {
            key: identifier,
            type: type,
            otp: otp
          }
        },
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to verify OTP for ${identifier}:`, error.message);
      throw error;
    }
  }

  async updateUser(userId, data) {
    try {
      const response = await axios.patch(
        `${IAM_USER_SERVICE_URL}/users/${userId}`,
        data,
        { timeout: 5000 }
      );
      return response.data;
    } catch (error) {
      console.error(`Failed to update user ${userId}:`, error.message);
      throw error;
    }
  }
}

const iamUserService = new IamUserService();

// ===== Utility Functions =====
function isEmail(identifier) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

function buildKeycloakAuthUrl(state, codeChallenge, loginHint) {
  const params = new URLSearchParams({
    client_id: 'diksha-portal',
    redirect_uri: FRONTEND_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state: state,
    nonce: uuidv4(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    login_hint: loginHint
  });

  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params.toString()}`;
}

// ===== Routes =====

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'iam-orchestrator' });
});

/**
 * POST /iam/login/start
 * 
 * Initiates login flow by checking if user exists in IAM service
 * and determining next action
 */
app.post('/iam/login/start', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json({
        error: 'Missing identifier (email or phone)'
      });
    }

    // Determine if identifier is email or phone
    const isEmailId = isEmail(identifier);
    let iamUser = null;

    if (isEmailId) {
      iamUser = await iamUserService.findUserByEmail(identifier);
    } else {
      iamUser = await iamUserService.findUserByPhone(identifier);
    }

    // User not found
    if (!iamUser) {
      return res.json({
        nextAction: 'USER_NOT_FOUND'
      });
    }

    // Check activation status
    const activationStatus = iamUser.activationStatus || 'LEGACY_ONLY';

    if (activationStatus === 'ACTIVE') {
      // User is already active, generate auth URL for normal login
      const state = uuidv4();
      const expiresAt = Date.now() + STATE_STORE_TTL;
      stateStore.set(state, { expiresAt, identifier });

      return res.json({
        nextAction: 'KEYCLOAK_LOGIN',
        redirectUrl: buildKeycloakAuthUrl(state, '', identifier)
      });
    }

    // User needs OTP verification for activation
    try {
      const otpResponse = await iamUserService.generateOtp(
        identifier,
        isEmailId ? 'email' : 'phone'
      );

      const txnId = uuidv4();
      const expiresAt = Date.now() + STATE_STORE_TTL;
      txnIdStore.set(txnId, {
        identifier,
        iamUserId: iamUser.id || iamUser._id,
        activationStatus,
        expiresAt
      });

      const maskedIdentifier = isEmailId
        ? identifier.replace(/(.{2})[^@]*(@.*)/, '$1***$2')
        : identifier.replace(/(\d{2})\d*(\d{2})/, '$1****$2');

      return res.json({
        nextAction: 'VERIFY_OTP',
        txnId,
        maskedIdentifier
      });
    } catch (error) {
      console.error('Failed to generate OTP:', error.message);
      return res.status(500).json({
        error: 'Failed to generate OTP',
        details: error.message
      });
    }
  } catch (error) {
    console.error('Error in /iam/login/start:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * POST /iam/activation/verify-otp
 * 
 * Verifies OTP, creates/updates Keycloak user, and returns authorization URL
 */
app.post('/iam/activation/verify-otp', async (req, res) => {
  try {
    const { txnId, identifier, otp, codeChallenge, redirectUri } = req.body;

    if (!txnId || !identifier || !otp || !codeChallenge) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate transaction
    const txnData = txnIdStore.get(txnId);
    if (!txnData) {
      return res.status(400).json({
        error: 'Invalid or expired transaction ID'
      });
    }

    // Verify OTP
    try {
      const isEmailId = isEmail(identifier);
      const otpResult = await iamUserService.verifyOtp(
        identifier,
        isEmailId ? 'email' : 'phone',
        otp
      );

      if (!otpResult || otpResult.error) {
        return res.status(400).json({
          error: 'OTP verification failed',
          details: otpResult?.error || 'Invalid OTP'
        });
      }
    } catch (error) {
      console.error('OTP verification error:', error.message);
      return res.status(400).json({
        error: 'OTP verification failed',
        details: error.message
      });
    }

    // Fetch IAM user details
    const iamUser = await iamUserService.getUserById(txnData.iamUserId);
    if (!iamUser) {
      return res.status(404).json({
        error: 'User not found in IAM service'
      });
    }

    // Determine username for Keycloak (prefer email)
    const keycloakUsername = iamUser.email || identifier;
    const keycloakEmail = iamUser.email || identifier;

    // Check if Keycloak user already exists
    let keycloakUser = await keycloakAdmin.findUserByEmail(keycloakEmail);
    if (!keycloakUser) {
      keycloakUser = await keycloakAdmin.findUserByUsername(keycloakUsername);
    }

    let keycloakUserId;
    try {
      if (keycloakUser) {
        // Update existing user
        keycloakUserId = keycloakUser.id;
        await keycloakAdmin.updateUser(keycloakUserId, {
          email: keycloakEmail,
          emailVerified: true,
          enabled: true,
          requiredActions: ['UPDATE_PASSWORD'],
          attributes: {
            sunbirdUserId: [txnData.iamUserId],
            migrationStatus: ['PASSWORD_PENDING'],
            phone: iamUser.phone ? [iamUser.phone] : []
          }
        });
      } else {
        // Create new Keycloak user
        keycloakUserId = await keycloakAdmin.createUser({
          username: keycloakUsername,
          email: keycloakEmail,
          emailVerified: true,
          enabled: true,
          firstName: iamUser.firstname || 'User',
          lastName: iamUser.lastname || '',
          requiredActions: ['UPDATE_PASSWORD'],
          attributes: {
            sunbirdUserId: [txnData.iamUserId],
            migrationStatus: ['PASSWORD_PENDING'],
            phone: iamUser.phone ? [iamUser.phone] : []
          }
        });

        // Assign LEARNER role to new user
        try {
          await keycloakAdmin.assignRoleToUser(keycloakUserId, 'LEARNER');
        } catch (roleError) {
          console.warn('Failed to assign LEARNER role:', roleError.message);
        }
      }

      // Update IAM user activation status
      try {
        await iamUserService.updateUser(txnData.iamUserId, {
          activationStatus: 'PASSWORD_SETUP_INITIATED',
          keycloakUserId: keycloakUserId
        });
      } catch (updateError) {
        console.warn('Failed to update IAM user activation status:', updateError.message);
      }
    } catch (error) {
      console.error('Failed to create/update Keycloak user:', error.message);
      return res.status(500).json({
        error: 'Failed to setup user in Keycloak',
        details: error.message
      });
    }

    // Generate authorization URL
    const state = uuidv4();
    const expiresAt = Date.now() + STATE_STORE_TTL;
    stateStore.set(state, {
      expiresAt,
      identifier,
      keycloakUserId,
      iamUserId: txnData.iamUserId
    });

    const authUrl = buildKeycloakAuthUrl(state, codeChallenge, keycloakUsername);

    // Clear transaction
    txnIdStore.delete(txnId);

    return res.json({
      nextAction: 'SET_PASSWORD',
      redirectUrl: authUrl
    });
  } catch (error) {
    console.error('Error in /iam/activation/verify-otp:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * GET /iam/me
 * 
 * Returns authenticated user profile and roles
 */
app.get('/iam/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7);

    // For demo purposes, decode JWT manually (in production, use proper JWT validation)
    let tokenData;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }
      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64').toString('utf-8');
      tokenData = JSON.parse(decoded);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid token',
        details: error.message
      });
    }

    // Extract user information from token
    const email = tokenData.email;
    const username = tokenData.preferred_username;
    const keycloakSub = tokenData.sub;

    if (!email && !username) {
      return res.status(401).json({
        error: 'Token does not contain email or username'
      });
    }

    // Find user in IAM service
    let iamUser = null;
    if (email) {
      iamUser = await iamUserService.findUserByEmail(email);
    }
    if (!iamUser && username) {
      iamUser = await iamUserService.findUserByPhone(username);
    }

    if (!iamUser) {
      return res.status(404).json({
        error: 'User not found in IAM service'
      });
    }

    // Update activation status if needed
    if (iamUser.activationStatus === 'PASSWORD_SETUP_INITIATED') {
      try {
        await iamUserService.updateUser(iamUser.id || iamUser._id, {
          activationStatus: 'ACTIVE'
        });
      } catch (error) {
        console.warn('Failed to update activation status:', error.message);
      }
    }

    // Return user profile
    return res.json({
      user: {
        id: iamUser.id || iamUser._id,
        firstname: iamUser.firstname,
        lastname: iamUser.lastname,
        email: iamUser.email,
        phone: iamUser.phone,
        dob: iamUser.dob,
        activationStatus: iamUser.activationStatus
      },
      roles: ['LEARNER'],
      orgs: [
        {
          orgId: 'diksha-demo-org',
          role: 'LEARNER'
        }
      ],
      keycloak: {
        sub: keycloakSub,
        preferred_username: tokenData.preferred_username,
        email: tokenData.email,
        given_name: tokenData.given_name,
        family_name: tokenData.family_name
      }
    });
  } catch (error) {
    console.error('Error in /iam/me:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * GET /iam/keycloak-login-url
 * 
 * Optional endpoint for already-active users
 */
app.get('/iam/keycloak-login-url', (req, res) => {
  try {
    const { identifier, codeChallenge } = req.query;

    if (!identifier || !codeChallenge) {
      return res.status(400).json({
        error: 'Missing identifier or codeChallenge'
      });
    }

    const state = uuidv4();
    const expiresAt = Date.now() + STATE_STORE_TTL;
    stateStore.set(state, { expiresAt, identifier });

    const authUrl = buildKeycloakAuthUrl(state, codeChallenge, identifier);

    return res.json({
      redirectUrl: authUrl
    });
  } catch (error) {
    console.error('Error in /iam/keycloak-login-url:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`IAM Orchestrator running on port ${PORT}`);
  console.log(`Keycloak URL: ${KEYCLOAK_URL}`);
  console.log(`IAM User Service URL: ${IAM_USER_SERVICE_URL}`);
  console.log(`Frontend Redirect URI: ${FRONTEND_REDIRECT_URI}`);
});
