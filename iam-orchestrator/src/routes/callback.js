import { Router } from 'express';
import axios from 'axios';
import {
  KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID, FRONTEND_REDIRECT_URI
} from '../config/index.js';
import { getLineNum, maskIdentifier } from '../utils/helpers.js';
import { validateTokenClaims } from '../utils/token.js';
import { logKeycloakCall } from '../services/keycloak.js';
import mappingStore from '../stores/mappingStore.js';
import stateStore from '../stores/stateStore.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/auth/callback
// Orchestrator-mediated authorization code exchange
// ──────────────────────────────────────────────────────────────────────────────
router.post('/iam/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ error: 'code and state are required' });
    }

    console.log(`[CALLBACK] /iam/auth/callback – state: ${state} ${getLineNum()}`);

    // ── STEP 1: Validate state and retrieve server-side PKCE data ──
    const stateData = await stateStore.get(state);
    if (!stateData || Date.now() > stateData.expiresAt) {
      console.warn(`[CALLBACK] Invalid or expired state: ${state} ${getLineNum()}`);
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    const { identifier, iamUserId, codeVerifier, nonce, activationStatus } = stateData;
    console.log(`[CALLBACK] State validated for ${maskIdentifier(identifier)}, iamUserId: ${iamUserId} ${getLineNum()}`);

    // ── STEP 2: Exchange authorization code with Keycloak using server-side code_verifier ──
    const tokenEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    console.log(`[KEYCLOAK-REQ] POST ${tokenEndpoint} (grant_type: authorization_code, code_verifier: [server-side]) ${getLineNum()}`);

    let tokenResp;
    try {
      tokenResp = await axios.post(
        `${KEYCLOAK_URL}${tokenEndpoint}`,
        new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     KEYCLOAK_CLIENT_ID,
          code,
          redirect_uri:  FRONTEND_REDIRECT_URI,
          code_verifier: codeVerifier  // Use server-side stored verifier
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
      );
    } catch (err) {
      console.error(`[CALLBACK] Token exchange failed ${getLineNum()}:`, err.response?.data || err.message);
      logKeycloakCall('POST', tokenEndpoint, err.response?.status || 'ERROR', null, err);
      return res.status(400).json({ error: 'Authorization failed. Code may be invalid or expired.' });
    }

    logKeycloakCall('POST', tokenEndpoint, tokenResp.status, `access_token: ${tokenResp.data.access_token ? 'granted' : 'null'}`);

    if (!tokenResp.data.access_token || !tokenResp.data.id_token) {
      console.error(`[CALLBACK] Missing tokens in response ${getLineNum()}`);
      return res.status(400).json({ error: 'Invalid token response from authorization server' });
    }

    // ── STEP 3: Validate ID token claims ──
    let idTokenPayload;
    const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
    try {
      idTokenPayload = validateTokenClaims(
        tokenResp.data.id_token,
        nonce,
        expectedIssuer,
        KEYCLOAK_CLIENT_ID
      );
      console.log(`[CALLBACK] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[CALLBACK] Token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(400).json({ error: `Token validation failed: ${validateErr.message}` });
    }

    try {
      validateTokenClaims(
        tokenResp.data.access_token,
        null,  // no nonce in access token
        expectedIssuer,
        null   // some servers don't set aud in access token
      );
      console.log(`[CALLBACK] Access token validated ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[CALLBACK] Access token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(400).json({ error: `Access token validation failed: ${validateErr.message}` });
    }

    // ── STEP 4: Extract claims from ID token ──
    const kcSubject    = idTokenPayload.sub;
    const kcUsername   = idTokenPayload.preferred_username;
    const kcEmail      = idTokenPayload.email;
    const kcIamUserId  = idTokenPayload.iamUserId || idTokenPayload.iam_user_id;

    console.log(`[CALLBACK] Keycloak user: subject=${kcSubject}, username=${kcUsername}, iamUserId=${kcIamUserId} ${getLineNum()}`);

    // ── STEP 5: Always mark mapping as ACTIVE after successful token exchange ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        username: kcUsername,
        activationStatus: 'ACTIVE',
        updatedAt: Date.now()
      });
      console.log(`[CALLBACK] Mapping status set to ACTIVE for ${maskIdentifier(identifier)} ${getLineNum()}`);
    } catch (updateErr) {
      console.warn(`[CALLBACK] Failed to update mapping ${getLineNum()}:`, updateErr.message);
    }

    // ── STEP 6: Build session response ──
    const sessionContext = {
      user: {
        id:        kcSubject,
        username:  kcUsername,
        email:     kcEmail,
        name:      idTokenPayload.name,
        iamUserId: kcIamUserId || iamUserId
      },
      tokens: {
        accessToken:  tokenResp.data.access_token,
        idToken:      tokenResp.data.id_token,
        refreshToken: tokenResp.data.refresh_token,
        expiresIn:    tokenResp.data.expires_in,
        tokenType:    tokenResp.data.token_type
      },
      roles:       idTokenPayload.realm_access?.roles || [],
      clientRoles: idTokenPayload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || [],
      activationStatus
    };

    console.log(`[CALLBACK] Returning session context for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // Clean up state store
    await stateStore.delete(state);

    return res.json(sessionContext);

  } catch (err) {
    console.error(`[CALLBACK] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
