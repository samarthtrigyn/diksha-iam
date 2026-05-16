// ──────────────────────────────────────────────────────────────────────────────
// SSO Provider Configuration
// ──────────────────────────────────────────────────────────────────────────────

// State SSO providers (parameterized by state code)
export const STATE_SSO_PROVIDERS = {};
// Example: STATE_SSO_PROVIDERS['maharashtra'] = { clientId, clientSecret, ... }

// Keycloak-brokered providers: Keycloak owns the external IdP OAuth2 dance;
// the orchestrator only does PKCE code exchange with Keycloak.
export const KC_BROKERED_PROVIDERS = ['kc-google-broker'];

export const SUPPORTED_SSO_PROVIDERS = [
  'google',
  ...KC_BROKERED_PROVIDERS,
  ...Object.keys(STATE_SSO_PROVIDERS).map(state => `state_${state}`)
];

/**
 * Extract external identity from provider token payload
 */
export function extractExternalIdentity(provider, tokenPayload) {
  if (provider === 'google') {
    return {
      provider: 'google',
      idtype: 'sub',
      externalid: tokenPayload.sub
    };
  }

  // Keycloak-brokered Google: Keycloak issues the token but propagates the
  // original Google subject under the 'identity_provider_identity' claim.
  if (provider === 'kc-google-broker') {
    return {
      provider: 'google',
      idtype: 'sub',
      externalid: tokenPayload.identity_provider_identity || tokenPayload.sub
    };
  }

  if (provider.startsWith('state_')) {
    const stateCode = provider.replace('state_', '');
    return {
      provider: `state_${stateCode}`,
      idtype: 'stateUserId',
      externalid: tokenPayload.state_user_id || tokenPayload.sub
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Extract user info from provider token payload
 */
export function extractUserInfoFromToken(tokenPayload) {
  return {
    email: tokenPayload.email || null,
    emailVerified: tokenPayload.email_verified || false,
    phone: tokenPayload.phone || null,
    phoneVerified: tokenPayload.phone_verified || false,
    firstname: tokenPayload.given_name || tokenPayload.first_name || 'User',
    lastname: tokenPayload.family_name || tokenPayload.last_name || ''
  };
}
