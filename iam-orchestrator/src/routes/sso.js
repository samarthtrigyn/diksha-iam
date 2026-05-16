import { Router } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  ORCHESTRATOR_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  FRONTEND_REDIRECT_URI, IAM_SERVICE_URL, SESSION_TTL, SESSION_COOKIE_NAME,
  KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM,
  KC_BROKER_CLIENT_ID, KC_BROKER_CLIENT_SECRET
} from '../config/index.js';
import { getLineNum } from '../utils/helpers.js';
import { validateTokenClaims } from '../utils/token.js';
import { generatePKCE } from '../utils/pkce.js';
import { getAdminToken, upsertKeycloakUserFromIamUser } from '../services/keycloak.js';
import {
  SUPPORTED_SSO_PROVIDERS, KC_BROKERED_PROVIDERS, STATE_SSO_PROVIDERS,
  extractExternalIdentity, extractUserInfoFromToken
} from '../services/sso.js';
import mappingStore from '../stores/mappingStore.js';
import stateStore from '../stores/stateStore.js';
import { createSession } from '../services/session.js';
import { setSecureCookie } from '../middleware/secureCookie.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/sso/:provider/login
// ──────────────────────────────────────────────────────────────────────────────
router.get('/iam/sso/:provider/login', async (req, res) => {
  try {
    const { provider } = req.params;
    const { redirectUri } = req.query;

    console.log(`[SSO-LOGIN] Starting ${provider} SSO login ${getLineNum()}`);

    if (!SUPPORTED_SSO_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    const state = uuidv4();
    const nonce = uuidv4();

    // Store state with provider metadata
    await stateStore.set(state, {
      flow: 'SSO_LOGIN',
      provider,
      nonce,
      redirectUri: redirectUri || FRONTEND_REDIRECT_URI,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[SSO-LOGIN] State stored, initiating ${provider} auth ${getLineNum()}`);

    // Build provider authorization URL
    let authUrl;
    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        redirect_uri: `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`
      });
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else if (provider === 'kc-google-broker') {
      // Keycloak brokers the Google OAuth2 flow. The orchestrator sends a normal
      // PKCE authorization request to Keycloak with kc_idp_hint=google so Keycloak
      // skips its login page and redirects the user straight to Google.
      // The codeVerifier is generated here and stored in stateStore so the callback
      // can complete the PKCE exchange with Keycloak.
      const { codeVerifier, codeChallenge } = generatePKCE();
      // Overwrite the state entry to include PKCE fields (state was already set above)
      await stateStore.set(state, {
        flow: 'SSO_LOGIN',
        provider,
        nonce,
        codeVerifier,
        redirectUri: redirectUri || FRONTEND_REDIRECT_URI,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      const params = new URLSearchParams({
        client_id:             KC_BROKER_CLIENT_ID,
        response_type:         'code',
        scope:                 'openid email profile',
        state,
        nonce,
        redirect_uri:          `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`,
        code_challenge:        codeChallenge,
        code_challenge_method: 'S256',
        kc_idp_hint:           'google'
      });
      authUrl = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;
    } else if (provider.startsWith('state_')) {
      const stateCode = provider.replace('state_', '');
      const config = STATE_SSO_PROVIDERS[stateCode];
      if (!config) {
        return res.status(400).json({ error: `State SSO not configured: ${stateCode}` });
      }
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        scope: config.scopes ? config.scopes.join(' ') : 'openid email',
        state,
        nonce,
        redirect_uri: `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`
      });
      authUrl = `${config.authEndpoint}?${params}`;
    }

    return res.json({ authUrl, state });
  } catch (err) {
    console.error(`[SSO-LOGIN] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Failed to initiate SSO login' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/sso/:provider/callback
// ──────────────────────────────────────────────────────────────────────────────
router.get('/iam/sso/:provider/callback', async (req, res) => {
  try {
    const { provider } = req.params;
    const { code, state, error } = req.query;

    console.log(`[SSO-CALLBACK] Received ${provider} callback, state: ${state} ${getLineNum()}`);
    console.log(`[SSO-CALLBACK] Full Object ${JSON.stringify(req.query)} callback, state: ${state} ${getLineNum()}`);

    // Handle provider error
    if (error) {
      console.error(`[SSO-CALLBACK] Provider error: ${error} ${getLineNum()}`);
      return res.status(400).json({ error: `SSO provider error: ${error}` });
    }

    // Validate state
    const stateData = await stateStore.get(state);
    if (!stateData || stateData.provider !== provider) {
      console.error(`[SSO-CALLBACK] Invalid or expired state ${getLineNum()}`);
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    console.log(`[SSO-CALLBACK] State validated for ${provider} ${getLineNum()}`);

    // Exchange code for ID token
    let tokenPayload;
    let kcTokens = null; // only populated for kc-google-broker
    try {
      if (provider === 'google') {
        console.log(`[SSO-CALLBACK] Exchanging code with Google OAuth2 ${getLineNum()}`);
        const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
          grant_type: 'authorization_code',
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`
        }, { timeout: 10000 });

        console.log(`[SSO-CALLBACK] Got ID token from Google, validating ${getLineNum()}`);
        console.log(`[SSO-CALLBACK] Got ID token from Google, ${JSON.stringify(tokenResp.data)} ${getLineNum()}`);
        tokenPayload = validateTokenClaims(tokenResp.data.id_token, stateData.nonce, 'https://accounts.google.com', GOOGLE_CLIENT_ID);
      } else if (provider === 'kc-google-broker') {
        // Keycloak completed the Google broker flow and redirected back with a
        // Keycloak authorization code. Exchange it with Keycloak using the
        // PKCE code_verifier stored in stateStore at login time.
        console.log(`[SSO-CALLBACK] Exchanging code with Keycloak (kc-google-broker) ${getLineNum()}`);
        const kcPayload = new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     KC_BROKER_CLIENT_ID,
          code,
          redirect_uri:  `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`,
          code_verifier: stateData.codeVerifier,
          ...(KC_BROKER_CLIENT_SECRET && { client_secret: KC_BROKER_CLIENT_SECRET })
        });
        const tokenResp = await axios.post(
          `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
          kcPayload.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
        );
        if (!tokenResp.data.access_token || !tokenResp.data.id_token) {
          throw new Error('Keycloak did not return required tokens');
        }
        console.log(`[SSO-CALLBACK] Got tokens from Keycloak, validating ID token ${tokenResp.data.id_token} ${getLineNum()}`);
        
        // Validate Keycloak-issued ID token (issuer = Keycloak, not Google)
        const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
        tokenPayload = validateTokenClaims(
          tokenResp.data.id_token,
          stateData.nonce,
          expectedIssuer,
          KC_BROKER_CLIENT_ID
        );
        console.log(`[SSO-CALLBACK] Keycloak ID token validated, sub: ${tokenPayload.sub} ${getLineNum()}`);
        // Preserve real Keycloak tokens so the session can support token refresh
        kcTokens = {
          accessToken:  tokenResp.data.access_token,
          idToken:      tokenResp.data.id_token,
          refreshToken: tokenResp.data.refresh_token,
          expiresIn:    tokenResp.data.expires_in,
          tokenType:    'Bearer'
        };
      } else if (provider.startsWith('state_')) {
        const stateCode = provider.replace('state_', '');
        const config = STATE_SSO_PROVIDERS[stateCode];

        const tokenResp = await axios.post(config.tokenEndpoint, {
          grant_type: 'authorization_code',
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: `${ORCHESTRATOR_URL}/iam/sso/${provider}/callback`
        }, { timeout: 10000 });

        // For state SSO, we'll skip signature validation and just extract claims
        // In production, validate the signature with the state's public key
        tokenPayload = JSON.parse(Buffer.from(tokenResp.data.id_token.split('.')[1], 'base64url').toString());
      }
    } catch (tokenErr) {
      console.error(`[SSO-CALLBACK] Token exchange/validation failed ${getLineNum()}:`, tokenErr.message);
      return res.status(400).json({ error: 'Token exchange failed' });
    }

    // Extract external identity and user info
    const externalIdentity = extractExternalIdentity(provider, tokenPayload);
    const userInfo = extractUserInfoFromToken(tokenPayload);

    console.log(`[SSO-CALLBACK] Extracted user info from ${provider}: ${userInfo.email || userInfo.firstname} ${getLineNum()}`);

    // Resolve or create user via User Service
    let ssoResult;
    try {
      const resolveResp = await axios.post(`${IAM_SERVICE_URL}/users/sso-resolve`, {
        provider: externalIdentity.provider,
        idtype: externalIdentity.idtype,
        externalid: externalIdentity.externalid,
        ...userInfo
      }, { timeout: 15000 });
      ssoResult = resolveResp.data;
    } catch (resolveErr) {
      console.error(`[SSO-CALLBACK] User resolution failed ${getLineNum()}:`, resolveErr.response?.data || resolveErr.message);
      if (resolveErr.response?.status === 409) {
        await stateStore.delete(state);
        return res.status(409).json({
          flow: 'CONFLICT_RESOLUTION_REQUIRED',
          ssoProvider: provider,
          conflict: resolveErr.response.data.conflict
        });
      }
      return res.status(500).json({ error: 'User resolution failed' });
    }

    const { user, action, conflict } = ssoResult;

    // Handle conflict
    if (action === 'CONFLICT') {
      console.warn(`[SSO-CALLBACK] Conflict detected for ${provider}: ${conflict.reason} ${getLineNum()}`);
      await stateStore.delete(state);
      return res.status(409).json({
        flow: 'CONFLICT_RESOLUTION_REQUIRED',
        ssoProvider: provider,
        conflict
      });
    }

    console.log(`[SSO-CALLBACK] User resolution action: ${action} for ${user.id} ${getLineNum()}`);

    // Get or create Keycloak user
    const adminToken = await getAdminToken();
    await upsertKeycloakUserFromIamUser(user, adminToken);

    // Update mapping to ACTIVE (SSO users are immediately active)
    await mappingStore.set(user.id, {
      iamUserId: user.id,
      username: user.username,
      activationStatus: 'ACTIVE',
      ssoProvider: provider,
      updatedAt: Date.now()
    });

    console.log(`[SSO-CALLBACK] Updated mapping to ACTIVE for ${user.id}, ssoProvider: ${provider} ${getLineNum()}`);

    // Clean up state
    await stateStore.delete(state);

    // Create an application session.
    // For kc-google-broker: real Keycloak tokens are available (kcTokens), so
    // they are stored in the session — token refresh via /iam/auth/refresh works.
    // For direct Google / state providers: no Keycloak tokens; session is
    // cookie-only with null token fields.
    const sessionTokens = kcTokens || {
      accessToken: null,
      idToken: null,
      refreshToken: null,
      expiresIn: null,
      tokenType: 'Bearer'
    };

    const session = await createSession(user.id, user.username, sessionTokens, SESSION_TTL);
    const sessionId = session.sessionId;
    console.log(`[SSO-CALLBACK] Session created: ${sessionId} ${getLineNum()}`);

    // Set HttpOnly secure cookie with sessionId
    setSecureCookie(res, SESSION_COOKIE_NAME, sessionId, {
      maxAge: SESSION_TTL * 1000,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'Strict'
    });

    console.log(`[SSO-CALLBACK] SSO authentication successful for ${provider}, action: ${action} ${getLineNum()}`);

    // Redirect 302 to redirectUri shared by the client during login init session in cookie and sso_success=true and provider as query params so that frontend can detect successful SSO login and proceed with OIDC flow (e.g. call /iam/auth/session/exchange to get access_token and id_token for the SSO user if required)
    const frontendCallbackUrl = `${stateData.redirectUri}?sso_success=true&provider=${provider}`;
    console.log(`[SSO-CALLBACK] Redirecting to frontend: ${stateData.redirectUri} ${getLineNum()}`);
    return res.redirect(frontendCallbackUrl);
  } catch (err) {
    console.error(`[SSO-CALLBACK] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
