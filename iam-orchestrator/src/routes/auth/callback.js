import { Router } from 'express';
import axios from 'axios';
import {
  KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM,
  KEYCLOAK_PORTAL_CLIENT_ID, KEYCLOAK_MOBILE_CLIENT_ID, SESSION_TTL, SESSION_COOKIE_NAME
} from '../../config/index.js';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { validateTokenClaims } from '../../utils/token.js';
import { logKeycloakCall } from '../../services/keycloak.js';
import { createSession } from '../../services/session.js';
import { setSecureCookie } from '../../middleware/secureCookie.js';
import mappingStore from '../../stores/mappingStore.js';
import stateStore from '../../stores/stateStore.js';
import txnStore from '../../stores/txnStore.js';
import sessionCodeStore from '../../stores/sessionCodeStore.js';
import { validateCallback } from '../../middleware/validation.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/auth/callback  (Keycloak redirects here with ?code=&state=)
// POST /iam/auth/callback (legacy: frontend posts code+state in body)
//
// Authorization Code Exchange:
// 1. Validate state → get txnId
// 2. Load txn → get PKCE codeVerifier, nonce, clientId, redirectUri, channel
// 3. Exchange code with PKCE
// 4. Validate ID token (issuer, audience, nonce)
// 5. Create session
// 6. For MOBILE: Generate sessionCode and redirect with sessionCode query param
// 7. For WEB: Set HttpOnly cookie and redirect
// ──────────────────────────────────────────────────────────────────────────────
async function handleCallback(req, res) {
  try {
    // Support both GET (query params) and POST (body)
    const code = req.query.code || req.body?.code;
    const state = req.query.state || req.body?.state;

    if (!code || !state) {
      console.warn(`[CALLBACK] Missing code or state ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'code and state are required',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[CALLBACK] state: ${state} ${getLineNum()}`);

    // ── STEP 1: Validate state and load transaction ID ──
    const stateData = await stateStore.get(state);
    if (!stateData) {
      console.warn(`[CALLBACK] Invalid or expired state: ${state} ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_state',
        errorDescription: 'Invalid or expired state parameter',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    const { txnId } = stateData;
    console.log(`[CALLBACK] State validated → txnId: ${txnId} ${getLineNum()}`);

    // ── STEP 2: Load transaction data ──
    const txnData = await txnStore.get(txnId);
    if (!txnData) {
      console.warn(`[CALLBACK] Transaction not found: ${txnId} ${getLineNum()}`);
      return res.status(400).json({
        error: 'txn_not_found',
        errorDescription: 'Transaction not found or expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    if (Date.now() > txnData.expiresAt) {
      console.warn(`[CALLBACK] Transaction expired: ${txnId} ${getLineNum()}`);
      await txnStore.delete(txnId);
      return res.status(400).json({
        error: 'txn_expired',
        errorDescription: 'Transaction expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    const {
      identifier,
      iamUserId,
      username,
      codeVerifier,
      nonce,
      clientId,
      redirectUri,
      channel,
      kcCallbackUrl
    } = txnData;

    console.log(
      `[CALLBACK] Transaction loaded for ${maskIdentifier(identifier)} (${iamUserId}) ${getLineNum()}`
    );

    // ── STEP 3: Exchange authorization code with Keycloak using server-side code_verifier ──
    const tokenEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    console.log(
      `[CALLBACK] Exchanging code with Keycloak (code_verifier: [server-side]) ${getLineNum()}`
    );

    let tokenResp;
    try {
      // Select client_id based on channel (WEB uses portal, MOBILE uses mobile)
      const keycloakClientId = channel === 'MOBILE' ? KEYCLOAK_MOBILE_CLIENT_ID : KEYCLOAK_PORTAL_CLIENT_ID;
      
      const requestPayload = {
        grant_type: 'authorization_code',
        client_id: keycloakClientId,
        code,
        redirect_uri: kcCallbackUrl, // Keycloak redirect_uri (orchestrator callback)
        code_verifier: codeVerifier
      };

      tokenResp = await axios.post(
        `${KEYCLOAK_URL}${tokenEndpoint}`,
        new URLSearchParams(requestPayload).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );

      console.log(
        `[CALLBACK] Token exchange successful: access_token=${tokenResp.data.access_token ? 'granted' : 'missing'} ${getLineNum()}`
      );
    } catch (err) {
      console.error(
        `[CALLBACK] Token exchange failed ${getLineNum()}:`,
        err.response?.data || err.message
      );
      logKeycloakCall('POST', tokenEndpoint, err.response?.status || 'ERROR', null, err);
      return res.status(400).json({
        error: 'authorization_failed',
        errorDescription: 'Authorization code exchange failed',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    logKeycloakCall(
      'POST',
      tokenEndpoint,
      tokenResp.status,
      `access_token: ${tokenResp.data.access_token ? 'granted' : 'null'}`
    );

    if (!tokenResp.data.access_token || !tokenResp.data.id_token) {
      console.error(`[CALLBACK] Missing tokens in Keycloak response ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_token_response',
        errorDescription: 'Keycloak did not return required tokens',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 4: Validate ID token claims ──
    let idTokenPayload;
    const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
    try {
      const keycloakClientId = channel === 'MOBILE' ? KEYCLOAK_MOBILE_CLIENT_ID : KEYCLOAK_PORTAL_CLIENT_ID;
      idTokenPayload = validateTokenClaims(
        tokenResp.data.id_token,
        nonce,
        expectedIssuer,
        keycloakClientId
      );
      console.log(
        `[CALLBACK] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`
      );
    } catch (validateErr) {
      console.error(
        `[CALLBACK] ID token validation failed ${getLineNum()}:`,
        validateErr.message
      );
      return res.status(400).json({
        error: 'invalid_id_token',
        errorDescription: `Token validation failed: ${validateErr.message}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Validate access token
    try {
      validateTokenClaims(
        tokenResp.data.access_token,
        null, // no nonce in access token
        expectedIssuer,
        null // some servers don't set aud in access token
      );
      console.log(`[CALLBACK] Access token validated ${getLineNum()}`);
    } catch (validateErr) {
      console.error(
        `[CALLBACK] Access token validation failed ${getLineNum()}:`,
        validateErr.message
      );
      return res.status(400).json({
        error: 'invalid_access_token',
        errorDescription: `Access token validation failed: ${validateErr.message}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 5: Update mapping to ACTIVE ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        username,
        activationStatus: 'ACTIVE',
        updatedAt: Date.now()
      });
      console.log(
        `[CALLBACK] Mapping status set to ACTIVE for ${maskIdentifier(identifier)} ${getLineNum()}`
      );
    } catch (updateErr) {
      console.warn(
        `[CALLBACK] Failed to update mapping ${getLineNum()}:`,
        updateErr.message
      );
    }

    // ── STEP 6: Create application session ──
    let sessionId;
    try {
      const session = await createSession(
        iamUserId,
        username,
        {
          accessToken: tokenResp.data.access_token,
          idToken: tokenResp.data.id_token,
          refreshToken: tokenResp.data.refresh_token,
          expiresIn: tokenResp.data.expires_in,
          tokenType: 'Bearer'
        },
        SESSION_TTL,
        { channel, clientId }
      );

      sessionId = session.sessionId;
      console.log(`[CALLBACK] Session created: ${sessionId} ${getLineNum()}`);
    } catch (sessErr) {
      console.error(
        `[CALLBACK] Failed to create session ${getLineNum()}:`,
        sessErr.message
      );
      return res.status(500).json({
        error: 'session_creation_failed',
        errorDescription: 'Failed to create user session',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 7: Handle channel-specific response (WEB vs MOBILE) ──
    if (channel === 'MOBILE' || (redirectUri && !redirectUri.startsWith('http'))) {
      // MOBILE: Generate single-use sessionCode and redirect with query param
      console.log(`[CALLBACK] Channel: MOBILE → generating sessionCode ${getLineNum()}`);

      const sessionCode = sessionCodeStore.generateSessionCode();
      await sessionCodeStore.set(sessionCode, {
        sessionId,
        iamUserId,
        username,
        clientId
      });

      console.log(`[CALLBACK] SessionCode generated: ${sessionCode} ${getLineNum()}`);

      // Redirect to original redirectUri with sessionCode
      const redirectWithCode = `${redirectUri}?sessionCode=${sessionCode}`;
      console.log(
        `[CALLBACK] Redirecting to MOBILE client: ${redirectWithCode.substring(0, 80)}... ${getLineNum()}`
      );

      // Clean up state store
      await stateStore.delete(state);

      // Update txn status
      txnData.status = 'IAM_SESSION_CREATED';
      await txnStore.set(txnId, txnData);

      return res.redirect(302, redirectWithCode);
    } else {
      // WEB: Set HttpOnly secure cookie and redirect
      console.log(`[CALLBACK] Channel: WEB → setting secure cookie ${getLineNum()}`);

      setSecureCookie(res, SESSION_COOKIE_NAME, sessionId, {
        maxAge: SESSION_TTL * 1000,
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'Strict'
      });

      console.log(`[CALLBACK] Session cookie set: ${SESSION_COOKIE_NAME} ${getLineNum()}`);

      // Clean up state store
      await stateStore.delete(state);

      // Update txn status
      txnData.status = 'IAM_SESSION_CREATED';
      await txnStore.set(txnId, txnData);

      console.log(
        `[CALLBACK] Redirecting to WEB client: ${redirectUri.substring(0, 80)}... ${getLineNum()}`
      );

      return res.redirect(302, redirectUri);
    }

  } catch (err) {
    console.error(`[CALLBACK] Unexpected error ${getLineNum()}:`, err.stack );
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
}

router.get('/iam/auth/callback', handleCallback);

export default router;
