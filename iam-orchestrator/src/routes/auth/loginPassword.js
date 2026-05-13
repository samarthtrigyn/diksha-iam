import { Router } from 'express';
import {
  KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, SESSION_TTL, SESSION_COOKIE_NAME
} from '../../config/index.js';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { validateTokenClaims } from '../../utils/token.js';
import { directGrant } from '../../services/keycloak.js';
import { createSession } from '../../services/session.js';
import { setSecureCookie } from '../../middleware/secureCookie.js';
import txnStore from '../../stores/txnStore.js';
import mappingStore from '../../stores/mappingStore.js';

const router = Router();

/**
 * POST /iam/auth/login/password
 * 
 * Authenticate ACTIVE user with password via Keycloak direct grant
 * 
 * Request:
 *   - txnId (required): Transaction ID from /iam/auth/login/init (DIRECT_GRANT flow)
 *   - password (required): User password
 * 
 * Response (Success):
 *   - user: { id, username, email, name, iamUserId }
 *   - tokens: { accessToken, idToken, refreshToken, expiresIn }
 *   - roles: realm roles
 *   - clientRoles: client-specific roles
 *   - sessionId: application session ID (in secure cookie)
 * 
 * Response (Error):
 *   - error, errorDescription, statusCode
 */
router.post('/iam/auth/login/password', async (req, res) => {
  try {
    const { txnId, password } = req.body;

    if (!txnId || !password) {
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'txnId and password are required',
        statusCode: 400
      });
    }

    console.log(`[AUTH-LOGIN-PASSWORD] txnId: ${txnId} ${getLineNum()}`);

    // ── STEP 1: Validate transaction ──
    const txnData = await txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      console.warn(`[AUTH-LOGIN-PASSWORD] Invalid or expired txnId: ${txnId} ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_txn',
        errorDescription: 'Transaction expired or invalid',
        statusCode: 400
      });
    }

    if (txnData.flow !== 'DIRECT_GRANT') {
      console.warn(`[AUTH-LOGIN-PASSWORD] Unexpected flow for txnId: ${txnData.flow} (expected DIRECT_GRANT) ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_flow',
        errorDescription: 'This transaction is not for direct grant authentication',
        statusCode: 400
      });
    }

    const { identifier, username, iamUserId } = txnData;
    console.log(`[AUTH-LOGIN-PASSWORD] Processing login for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 2: Attempt direct grant with Keycloak ──
    let tokenResp;
    try {
      tokenResp = await directGrant(username, password, KEYCLOAK_CLIENT_ID);
      console.log(`[AUTH-LOGIN-PASSWORD] Direct grant successful for ${maskIdentifier(identifier)} ${getLineNum()}`);
    } catch (grantErr) {
      const statusCode = grantErr.statusCode || 401;
      const error = grantErr.error || 'invalid_grant';
      const errorDescription = grantErr.errorDescription || 'Authentication failed';
      console.warn(`[AUTH-LOGIN-PASSWORD] Direct grant failed ${getLineNum()}:`, errorDescription);
      return res.status(statusCode).json({
        error,
        errorDescription,
        statusCode
      });
    }

    // ── STEP 3: Validate ID token ──
    let idTokenPayload;
    const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
    try {
      idTokenPayload = validateTokenClaims(
        tokenResp.id_token,
        null,
        expectedIssuer,
        KEYCLOAK_CLIENT_ID
      );
      console.log(`[AUTH-LOGIN-PASSWORD] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[AUTH-LOGIN-PASSWORD] Token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(401).json({
        error: 'invalid_token',
        errorDescription: `Token validation failed: ${validateErr.message}`,
        statusCode: 401
      });
    }

    // ── STEP 4: Create application session ──
    let sessionId;
    try {
      const session = await createSession(iamUserId, username, {
        accessToken: tokenResp.access_token,
        idToken: tokenResp.id_token,
        refreshToken: tokenResp.refresh_token,
        expiresIn: tokenResp.expires_in,
        tokenType: 'Bearer'
      }, SESSION_TTL);

      sessionId = session.sessionId;
      console.log(`[AUTH-LOGIN-PASSWORD] Session created: ${sessionId} ${getLineNum()}`);
    } catch (sessErr) {
      console.error(`[AUTH-LOGIN-PASSWORD] Failed to create session ${getLineNum()}:`, sessErr.message);
      return res.status(500).json({
        error: 'server_error',
        errorDescription: 'Failed to create user session',
        statusCode: 500
      });
    }

    // ── STEP 5: Set secure cookie ──
    setSecureCookie(res, SESSION_COOKIE_NAME, sessionId, {
      maxAge: SESSION_TTL * 1000,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'Strict'
    });

    // ── STEP 6: Update mapping ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        username,
        activationStatus: 'ACTIVE',
        updatedAt: Date.now()
      });
    } catch (mapErr) {
      console.warn(`[AUTH-LOGIN-PASSWORD] Failed to update mapping ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 7: Clean up transaction ──
    await txnStore.delete(txnId);

    console.log(`[AUTH-LOGIN-PASSWORD] Login successful for ${maskIdentifier(identifier)} ${getLineNum()}`);

    return res.json({
      user: {
        id: idTokenPayload.sub,
        username: idTokenPayload.preferred_username,
        email: idTokenPayload.email,
        name: idTokenPayload.name,
        iamUserId: idTokenPayload.iamUserId || idTokenPayload.iam_user_id || iamUserId
      },
      tokens: {
        accessToken: tokenResp.access_token,
        idToken: tokenResp.id_token,
        refreshToken: tokenResp.refresh_token,
        expiresIn: tokenResp.expires_in,
        tokenType: 'Bearer'
      },
      roles: idTokenPayload.realm_access?.roles || [],
      clientRoles: idTokenPayload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || [],
      sessionId,
      activationStatus: 'ACTIVE'
    });

  } catch (err) {
    console.error(`[AUTH-LOGIN-PASSWORD] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
