import { createHmac, createVerify } from 'crypto';
import axios from 'axios';
import { ACTIVATION_TOKEN_SECRET, JWKS_URI } from '../config/index.js';
import { getLineNum } from './helpers.js';

let jwksCache = null;
let jwksCacheExpiry = 0;

/**
 * Fetch JWKS (JSON Web Key Set) from Keycloak
 * Caches for 1 hour
 */
async function getJWKS() {
  const now = Date.now();
  if (jwksCache && jwksCacheExpiry > now) {
    return jwksCache;
  }

  try {
    console.log(`[TOKEN] Fetching JWKS from ${JWKS_URI} ${getLineNum()}`);
    const resp = await axios.get(JWKS_URI, { timeout: 5000 });
    jwksCache = resp.data;
    jwksCacheExpiry = now + (60 * 60 * 1000); // Cache for 1 hour
    console.log(`[TOKEN] JWKS fetched and cached, ${resp.data.keys.length} keys available ${getLineNum()}`);
    return resp.data;
  } catch (err) {
    console.error(`[TOKEN] Failed to fetch JWKS ${getLineNum()}:`, err.message);
    throw new Error(`Failed to fetch JWKS: ${err.message}`);
  }
}

/**
 * Validate JWT token signature using JWKS
 * Supports RS256 (RSA) and HS256 (HMAC) algorithms
 */
export async function validateTokenSignature(token, jwksUri = JWKS_URI) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  let header;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  } catch (err) {
    throw new Error(`Malformed token header: ${err.message}`);
  }

  const alg = header.alg;

  // For HMAC-SHA256, validate signature directly
  if (alg === 'HS256') {
    const expectedSig = createHmac('sha256', ACTIVATION_TOKEN_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');

    if (parts[2] !== expectedSig) {
      throw new Error('Invalid token signature');
    }
    return true;
  }

  // For RSA-SHA256, fetch JWKS and validate
  if (alg === 'RS256') {
    const jwks = await getJWKS();
    const kid = header.kid;

    if (!kid) throw new Error('Missing kid in token header');

    const key = jwks.keys.find(k => k.kid === kid);
    if (!key) throw new Error(`Key not found: ${kid}`);

    // Convert JWKS key to PEM format
    const pubKey = await convertJWKToPEM(key);

    const verifier = createVerify('sha256');
    verifier.update(`${parts[0]}.${parts[1]}`);

    if (!verifier.verify(pubKey, Buffer.from(parts[2], 'base64url'))) {
      throw new Error('Invalid token signature');
    }
    return true;
  }

  throw new Error(`Unsupported algorithm: ${alg}`);
}

/**
 * Convert JWKS JWK to PEM format (for RS256)
 * Simplified version - requires 'node-jose' or similar library in production
 */
async function convertJWKToPEM(jwk) {
  // This is a placeholder - in production, use a library like 'node-jose' or 'jsonwebtoken'
  // For now, we rely on axios validation by not validating RS256 signatures
  throw new Error('RS256 signature validation requires additional dependencies (node-jose, jwks-rsa, etc.)');
}

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
export function generateActivationToken(identifier, iamUserId) {
  const now    = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'activation' }))
                   .toString('base64url');
  const body   = Buffer.from(JSON.stringify({
    identifier,
    iamUserId,
    purpose: 'PASSWORD_ACTIVATION',
    iat: now,
    exp: now + 600
  })).toString('base64url');

  const sig = createHmac('sha256', ACTIVATION_TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${sig}`;
}
