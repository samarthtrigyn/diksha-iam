import { createHmac } from 'crypto';
import { ACTIVATION_TOKEN_SECRET } from '../config/index.js';

/**
 * Validate JWT token claims (issuer, audience, nonce, expiry).
 */
export function validateTokenClaims(token, expectedNonce, expectedIssuer, expectedAudience) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch (err) {
    throw new Error(`Malformed token payload: ${err.message}`);
  }

  const now = Math.floor(Date.now() / 1000);

  // Validate expiry
  if (payload.exp && payload.exp <= now) {
    throw new Error(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
  }

  // Validate issuer
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
  }

  // Validate audience (can be string or array)
  if (expectedAudience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(expectedAudience)) {
      throw new Error(`Invalid audience: ${expectedAudience} not in ${aud.join(', ')}`);
    }
  }

  // Validate nonce (for ID token)
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error(`Invalid nonce: expected ${expectedNonce}, got ${payload.nonce}`);
  }

  return payload;
}

/**
 * Generate a signed activation token.
 * Format: base64url(header).base64url(payload).base64url(HMAC-SHA256)
 * TTL: 10 minutes.  The Java authenticator validates this same format.
 */
export function generateActivationToken({ identifier, iamUserId }) {
  const now    = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'activation' }))
                   .toString('base64url');
  const body   = Buffer.from(JSON.stringify({
    identifier, iamUserId,
    purpose: 'PASSWORD_ACTIVATION',
    iat: now,
    exp: now + 600
  })).toString('base64url');

  const sig = createHmac('sha256', ACTIVATION_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${sig}`;
}
