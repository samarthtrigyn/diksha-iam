/**
 * Client Registry Configuration
 * Defines allowed clients, their redirect URIs, and supported channels.
 */

export const CLIENTS = {
  'diksha-portal': {
    name: 'DIKSHA Portal (Web)',
    type: 'WEB',
    channels: ['WEB'],
    redirectUris: [
      'http://localhost:5173/auth/callback',
      'http://localhost:5173/*',
      'https://portal.example.com/auth/callback',
    ],
    description: 'Web-based DIKSHA portal using httpOnly cookies',
  },
  'diksha-mobile': {
    name: 'DIKSHA Mobile App',
    type: 'MOBILE',
    channels: ['MOBILE'],
    redirectUris: [
      'diksha://auth/callback',
      'dikshamobile://auth/callback',
      'http://localhost:5173/*', //This is for testing purpose only
    ],
    description: 'Mobile app using sessionCode token exchange',
  },
};

/**
 * Validate that a clientId is registered.
 * @param {string} clientId - The client ID to validate
 * @returns {Object|null} - Client config or null if not found
 */
export function getClient(clientId) {
  return CLIENTS[clientId] || null;
}

/**
 * Validate that a redirectUri is allowed for the given clientId.
 * @param {string} clientId - The client ID
 * @param {string} redirectUri - The redirect URI to validate
 * @returns {boolean} - true if valid, false otherwise
 */
export function isRedirectUriAllowed(clientId, redirectUri) {
  const client = getClient(clientId);
  if (!client) return false;

  // Exact match or wildcard match (e.g., http://localhost:5173/*)
  return client.redirectUris.some((uri) => {
    if (uri.endsWith('/*')) {
      const base = uri.slice(0, -2); // Remove /*
      return redirectUri.startsWith(base);
    }
    return uri === redirectUri;
  });
}

/**
 * Get the channel type for a clientId.
 * Can be inferred from client config or determined from redirectUri scheme.
 * @param {string} clientId - The client ID
 * @param {string} redirectUri - Optional redirect URI to infer channel from
 * @returns {string} - 'WEB' or 'MOBILE'
 */
export function getChannelType(clientId, redirectUri = null) {
  const client = getClient(clientId);
  if (client) {
    return client.type;
  }

  // Fallback: infer from redirectUri scheme
  if (redirectUri) {
    const scheme = new URL(redirectUri).protocol.slice(0, -1); // Remove ':'
    if (['http', 'https'].includes(scheme)) {
      return 'WEB';
    }
    return 'MOBILE'; // Custom scheme → mobile
  }

  return 'WEB'; // Default
}

export default { CLIENTS, getClient, isRedirectUriAllowed, getChannelType };
