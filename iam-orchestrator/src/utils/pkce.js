import { randomBytes, createHash } from 'crypto';

/**
 * Generate PKCE code_verifier and code_challenge.
 * code_verifier: 43-128 character random string (use 128 for max security)
 * code_challenge: base64url(sha256(code_verifier))
 */
export function generatePKCE() {
  const codeVerifier = Buffer.from(randomBytes(96)).toString('base64url');
  const hash = createHash('sha256');
  hash.update(codeVerifier);
  const codeChallenge = hash.digest('base64url');
  return { codeVerifier, codeChallenge };
}
