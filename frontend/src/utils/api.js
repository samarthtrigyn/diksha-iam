import axios from 'axios';

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL || 'http://localhost:4000';

const apiClient = axios.create({
  baseURL: ORCHESTRATOR_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Add Authorization header to requests
 */
export function setAuthToken(token) {
  if (token) {
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common['Authorization'];
  }
}

/**
 * POST /iam/login/start
 * Start login flow with email/phone
 */
export async function postLoginStart(identifier) {
  try {
    const response = await apiClient.post('/iam/login/start', {
      identifier
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/activation/verify-otp
 * Verify OTP and get Keycloak authorization URL
 */
export async function postVerifyOtp(txnId, identifier, otp, codeChallenge, redirectUri) {
  try {
    const response = await apiClient.post('/iam/activation/verify-otp', {
      txnId,
      identifier,
      otp,
      codeChallenge,
      redirectUri
    });
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: error.message };
  }
}

/**
 * GET /iam/me
 * Get authenticated user profile
 */
export async function getMe() {
  try {
    const response = await apiClient.get('/iam/me');
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: error.message };
  }
}

/**
 * Exchange authorization code for tokens with Keycloak
 */
export async function exchangeCodeForToken(code, codeVerifier, clientId, redirectUri) {
  const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080';
  const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'diksha-demo';

  const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

  try {
    const response = await axios.post(
      tokenUrl,
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    throw error.response?.data || { error: error.message };
  }
}

export default apiClient;
