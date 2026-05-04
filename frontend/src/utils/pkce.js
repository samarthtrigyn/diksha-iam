// PKCE Code Generation Utilities

/**
 * Generate a random string of specified length
 */
function generateRandomString(length = 43) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

/**
 * Generate code challenge from code verifier using SHA-256
 */
async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert buffer to base64url
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashString = String.fromCharCode.apply(null, hashArray);
  const base64 = btoa(hashString);
  
  // Convert base64 to base64url (remove padding, replace +/, with -_)
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate PKCE code verifier and challenge
 */
export async function generatePKCE() {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  
  return {
    codeVerifier,
    codeChallenge
  };
}

/**
 * Store PKCE in sessionStorage
 */
export function storePKCE(codeVerifier) {
  sessionStorage.setItem('pkce_code_verifier', codeVerifier);
}

/**
 * Retrieve PKCE from sessionStorage
 */
export function getPKCE() {
  return sessionStorage.getItem('pkce_code_verifier');
}

/**
 * Clear PKCE from sessionStorage
 */
export function clearPKCE() {
  sessionStorage.removeItem('pkce_code_verifier');
}
