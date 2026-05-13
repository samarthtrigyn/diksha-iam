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
  },
  withCredentials: true  // Include cookies in requests
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

// ──────────────────────────────────────────────────────────────────────────────
// NEW OIDC CONTRACT ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /iam/auth/login/init
 * Start login transaction for both ACTIVE users (direct grant) and new users (OTP)
 */
export async function postLoginInit(identifier, clientId, redirectUri) {
  try {
    if (!identifier) {
      throw new Error('identifier is required');
    }

    const body = { identifier, ...(clientId && { clientId }), ...(redirectUri && { redirectUri }) };

    console.log('[API] POST /iam/auth/login/init with identifier:', maskIdentifier(identifier));

    const response = await apiClient.post('/iam/auth/login/init', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postLoginInit:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/auth/login/password
 * Authenticate ACTIVE user with password
 * Request must include txnId from postLoginInit
 */
export async function postLoginPassword(txnId, password) {
  try {
    if (!txnId || !password) {
      throw new Error('txnId and password are required');
    }

    const body = { txnId, password };

    console.log('[API] POST /iam/auth/login/password with txnId:', txnId);

    const response = await apiClient.post('/iam/auth/login/password', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postLoginPassword:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * GET /iam/auth/callback
 * Exchange authorization code for tokens (Keycloak callback)
 * Called when user is redirected back from Keycloak after authentication
 */
export async function getAuthCallback(code, state) {
  try {
    if (!code || !state) {
      throw new Error('code and state are required');
    }

    console.log('[API] GET /iam/auth/callback with code and state');

    const response = await apiClient.get('/iam/auth/callback', { params: { code, state } });
    return response.data;
  } catch (error) {
    console.error('[API] Error in getAuthCallback:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/auth/refresh
 * Refresh access token using refresh token from secure cookie or request body
 */
export async function postRefresh(refreshToken) {
  try {
    const body = { ...(refreshToken && { refreshToken }) };

    console.log('[API] POST /iam/auth/refresh');

    const response = await apiClient.post('/iam/auth/refresh', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postRefresh:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/auth/logout
 * Revoke tokens and clear session
 */
export async function postLogout(refreshToken, iamUserId) {
  try {
    const body = {
      ...(refreshToken && { refreshToken }),
      ...(iamUserId && { iamUserId })
    };

    console.log('[API] POST /iam/auth/logout');

    const response = await apiClient.post('/iam/auth/logout', body);

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

/**
 * GET /iam/users/me
 * Get authenticated user profile and session details
 * Supports both session cookie and Bearer token
 */
export async function getMe() {
  try {
    console.log('[API] GET /iam/users/me');

    const response = await apiClient.get('/iam/users/me');
    return response.data;
  } catch (error) {
    console.error('[API] Error in getMe:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/users/resolve
 * Resolve login identifier to internal userId
 * Returns user metadata if found
 */
export async function postUsersResolve(identifier) {
  try {
    if (!identifier) {
      throw new Error('identifier is required');
    }

    const body = { identifier };

    console.log('[API] POST /iam/users/resolve with identifier:', maskIdentifier(identifier));

    const response = await apiClient.post('/iam/users/resolve', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postUsersResolve:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/password/setup/init
 * Start password setup for new/legacy users
 */
export async function postPasswordSetupInit(identifier) {
  try {
    if (!identifier) {
      throw new Error('identifier is required');
    }

    const body = { identifier };

    console.log('[API] POST /iam/password/setup/init with identifier:', maskIdentifier(identifier));

    const response = await apiClient.post('/iam/password/setup/init', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postPasswordSetupInit:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/password/setup/complete
 * Complete password setup after OTP verification
 * Returns Keycloak auth URL with activation_token for password update
 */
export async function postPasswordSetupComplete(txnId, otp) {
  try {
    if (!txnId || !otp) {
      throw new Error('txnId and otp are required');
    }

    const body = { txnId, otp };

    console.log('[API] POST /iam/password/setup/complete with txnId:', txnId);

    const response = await apiClient.post('/iam/password/setup/complete', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postPasswordSetupComplete:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * GET /iam/sso/:provider/login
 * Start SSO login for Google, Apple, or State SSO
 */
export async function getSsoLogin(provider, redirectUri) {
  try {
    if (!provider) {
      throw new Error('provider is required');
    }

    console.log('[API] GET /iam/sso/:provider/login with provider:', provider);

    const response = await apiClient.get(`/iam/sso/${provider}/login`, {
      params: { ...(redirectUri && { redirectUri }) }
    });

    return response.data;
  } catch (error) {
    console.error('[API] Error in getSsoLogin:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * GET /iam/sso/:provider/callback
 * Handle SSO provider callback (Google, State SSO, etc.)
 */
export async function getSsoCallback(provider, code, state) {
  try {
    if (!provider || !code || !state) {
      throw new Error('provider, code, and state are required');
    }

    console.log('[API] GET /iam/sso/:provider/callback with provider:', provider);

    const response = await apiClient.get(`/iam/sso/${provider}/callback`, {
      params: { code, state }
    });

    return response.data;
  } catch (error) {
    console.error('[API] Error in getSsoCallback:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// LEGACY ENDPOINTS (Deprecated - kept for backward compatibility)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /iam/login/start
 * @deprecated Use postLoginInit and postLoginPassword instead
 */
export async function postLoginStart(identifier, password) {
  try {
    if (!identifier) {
      throw new Error('identifier is required');
    }

    const body = { identifier, ...(password && { password }) };

    console.log('[API] POST /iam/login/start (DEPRECATED - use postLoginInit) with identifier:', maskIdentifier(identifier));

    const response = await apiClient.post('/iam/login/start', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postLoginStart:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/activation/verify-otp
 * @deprecated Use postLoginInit + postRefresh flow instead
 */
export async function postVerifyOtp(txnId, otp) {
  try {
    const body = { txnId, otp };

    console.log('[API] POST /iam/activation/verify-otp (DEPRECATED)');

    const response = await apiClient.post('/iam/activation/verify-otp', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postVerifyOtp:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * POST /iam/auth/callback (legacy)
 * @deprecated Use getAuthCallback instead (GET instead of POST)
 */
export async function postAuthCallback(code, state) {
  try {
    if (!code || !state) {
      throw new Error('code and state are required');
    }

    const body = { code, state };

    console.log('[API] POST /iam/auth/callback (DEPRECATED - use getAuthCallback)');

    const response = await apiClient.post('/iam/auth/callback', body);
    return response.data;
  } catch (error) {
    console.error('[API] Error in postAuthCallback:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

/**
 * DEPRECATED: Use postRefresh instead
 * Exchange authorization code for tokens with Keycloak directly
 */
export async function exchangeCodeForToken(code, codeVerifier, clientId, redirectUri) {
  console.warn('[API] exchangeCodeForToken is deprecated. Use postRefresh instead.');
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
 * GET /iam/sso/:provider/callback (legacy)
 * @deprecated Use getSsoCallback instead
 */
export async function postSsoCallback(provider, code, state) {
  try {
    if (!provider || !code || !state) {
      throw new Error('Missing required SSO callback parameters');
    }

    console.log('[API] GET /iam/sso/:provider/callback (DEPRECATED - legacy postSsoCallback)');

    const response = await apiClient.get(`/iam/sso/${provider}/callback`, {
      params: { code, state }
    });

    return response.data;
  } catch (error) {
    console.error('[API] Error in postSsoCallback:', error.message);
    throw error.response?.data || { error: error.message };
  }
}

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
export default apiClient;
