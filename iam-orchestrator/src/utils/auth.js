import { KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM, FRONTEND_REDIRECT_URI } from '../config/index.js';

/** Build Keycloak auth URL that includes the activation_token (for migrated users). */
export function buildActivationAuthUrl({ state, nonce, codeChallenge, identifier,
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
export function buildLoginAuthUrl({ state, nonce, codeChallenge, identifier, redirectUri, clientId }) {
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
