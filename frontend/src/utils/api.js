import axios from 'axios';

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL || 'http://localhost:4000';

/**
 * Mask email/phone for logging
 */
function maskIdentifier(identifier) {
  if (!identifier) return '***';
  if (identifier.includes('@')) {
    const [local, domain] = identifier.split('@');
    return `${local.substring(0, 3)}***@${domain}`;
  } else {
    return identifier.substring(0, 3) + '***' + identifier.slice(-3);
  }
}

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
 * Start login flow with email/phone/username
 */
export async function postLoginStart(identifier, password) {
  try {
    // Validate required parameters
    if (!identifier) {
      console.error('postLoginStart: identifier is required');
      throw new Error('identifier is required');
    }
    
    const body = { identifier, ...(password && { password }) };
    
    console.log('[API] POST /iam/login/start with body:', {
      identifier: maskIdentifier(identifier),
      password: password ? '***' : undefined
    });
    
    const response = await apiClient.post('/iam/login/start', body);
    return response.data;
  } catch (error) {
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/activation/verify-otp
 * Verify OTP and get Keycloak authorization URL
 */
export async function postVerifyOtp(txnId, otp) {
  try {
    const body = {
      txnId,
      otp
    };
    
    console.log('[API] POST /iam/activation/verify-otp with body:', {
      txnId,
      otp: '***'
    });
    
    const response = await apiClient.post('/iam/activation/verify-otp', body);
    
    console.log('[API] Raw response:', response);
    console.log('[API] Response status:', response.status);
    console.log('[API] Response headers:', response.headers);
    console.log('[API] Response data:', response.data);
    
    if (!response.data || typeof response.data !== 'object') {
      console.error('[API] Invalid response format:', response.data);
      throw new Error('Invalid response format from server');
    }
    
    return response.data;
  } catch (error) {
    console.error('[API] Error in postVerifyOtp:');
    console.error('[API]   Error object:', error);
    console.error('[API]   Status:', error.response?.status);
    console.error('[API]   Response data:', error.response?.data);
    console.error('[API]   Response headers:', error.response?.headers);
    console.error('[API]   Message:', error.message);
    console.error('[API]   Stack:', error.stack);
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
 * POST /iam/auth/callback
 * Exchange authorization code for tokens via IAM orchestrator
 * The orchestrator handles the code exchange with Keycloak using server-side PKCE
 */
export async function postAuthCallback(code, state) {
  try {
    if (!code || !state) {
      throw new Error('code and state are required');
    }

    const body = { code, state };

    console.log('[API] POST /iam/auth/callback with code and state');

    const response = await apiClient.post('/iam/auth/callback', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postAuthCallback:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * DEPRECATED: Use postAuthCallback instead
 * Exchange authorization code for tokens with Keycloak directly
 * @deprecated - Token exchange is now handled by IAM orchestrator
 */
export async function exchangeCodeForToken(code, codeVerifier, clientId, redirectUri) {
  console.warn('[API] exchangeCodeForToken is deprecated. Use postAuthCallback instead.');
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

/**
 * POST /iam/logout
 * Revoke tokens and log out user from Keycloak
 */
export async function postLogout(refreshToken, iamUserId) {
  try {
    const body = {
      ...(refreshToken && { refreshToken }),
      ...(iamUserId && { iamUserId })
    };

    console.log('[API] POST /iam/logout with body:', { iamUserId });

    const response = await apiClient.post('/iam/logout', body);
    
    // Clear auth token from headers after logout
    setAuthToken(null);
    
    // Clear all auth-related session storage
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('id_token');
    sessionStorage.removeItem('token_decoded');
    sessionStorage.removeItem('user_profile');
    sessionStorage.removeItem('oauth_state');

    return response.data;
  } catch (error) {
    console.error('[API] Error in postLogout:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

export default apiClient;
