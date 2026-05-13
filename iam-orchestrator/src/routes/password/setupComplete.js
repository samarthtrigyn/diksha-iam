import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import {
  KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID, FRONTEND_REDIRECT_URI, SESSION_TTL, SESSION_COOKIE_NAME
} from '../../config/index.js';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { validateTokenClaims, generateActivationToken } from '../../utils/token.js';
import { generatePKCE } from '../../utils/pkce.js';
import { buildActivationAuthUrl } from '../../utils/auth.js';
import { logKeycloakCall } from '../../services/keycloak.js';
import { verifyOtp } from '../../services/otp.js';
import { createSession } from '../../services/session.js';
import { setSecureCookie } from '../../middleware/secureCookie.js';
import txnStore from '../../stores/txnStore.js';
import mappingStore from '../../stores/mappingStore.js';
import stateStore from '../../stores/stateStore.js';
import { validatePasswordSetupComplete } from '../../middleware/validation.js';

const router = Router();

/**
 * POST /iam/password/setup/complete
 * 
 * Complete password setup by:
 *   1. Verifying OTP
 *   2. Generating activation_token
 *   3. Returning Keycloak auth URL with activation_token and PKCE
 *   4. (Frontend redirects to Keycloak, which eventually calls /iam/auth/callback)
 * 
 * Request:
 *   - txnId (required): From /iam/password/setup/init
 *   - otp (required): 6-digit OTP
 * 
 * Response (Success):
 *   - flow: 'ACTIVATION_REQUIRED'
 *   - authUrl: Keycloak URL with activation_token and PKCE params
 *   - state: State parameter for validation on callback
 *   - codeChallenge: PKCE challenge (for reference)
 * 
 * Response (Error):
 *   - error, errorDescription, statusCode
 */
router.post('/iam/password/setup/complete', validatePasswordSetupComplete, async (req, res) => {
  try {
    const { txnId, otp } = req.body;

    if (!txnId || !otp) {
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'txnId and otp are required',
        statusCode: 400
      });
    }

    console.log(`[PASSWORD-SETUP-COMPLETE] txnId: ${txnId}, otp: ******* ${getLineNum()}`);

    // ── STEP 1: Validate transaction ──
    const txnData = await txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      console.warn(`[PASSWORD-SETUP-COMPLETE] Invalid or expired txnId: ${txnId} ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_txn',
        errorDescription: 'Transaction expired or invalid',
        statusCode: 400
      });
    }

    if (txnData.flow !== 'PASSWORD_SETUP') {
      console.warn(`[PASSWORD-SETUP-COMPLETE] Unexpected flow for txnId: ${txnData.flow} (expected PASSWORD_SETUP) ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_flow',
        errorDescription: 'This transaction is not for password setup',
        statusCode: 400
      });
    }

    const { identifier, username, iamUserId } = txnData;
    console.log(`[PASSWORD-SETUP-COMPLETE] Processing setup for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 2: Verify OTP ──
    try {
      await verifyOtp(identifier, otp);
      console.log(`[PASSWORD-SETUP-COMPLETE] OTP verified for ${maskIdentifier(identifier)} ${getLineNum()}`);
    } catch (otpErr) {
      console.warn(`[PASSWORD-SETUP-COMPLETE] OTP verification failed ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
      return res.status(401).json({
        error: 'invalid_otp',
        errorDescription: 'Invalid or expired OTP',
        statusCode: 401
      });
    }

    // ── STEP 3: Generate PKCE and state ──
    const { codeVerifier, codeChallenge } = generatePKCE();
    const nonce = require('uuid').v4();
    const state = require('uuid').v4();

    console.log(`[PASSWORD-SETUP-COMPLETE] Generated state: ${state}, nonce: ${nonce} ${getLineNum()}`);

    // ── STEP 4: Store state with activation context ──
    await stateStore.set(state, {
      identifier,
      iamUserId,
      username,
      codeVerifier,
      nonce,
      activationStatus: 'PASSWORD_SETUP',
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    // ── STEP 5: Build Keycloak auth URL with activation_token ──
    // This requires calling /iam/utils/auth.js buildActivationAuthUrl
    // But first, we need to generate activation_token
    const activationToken = generateActivationToken(identifier, iamUserId);

    console.log(`[PASSWORD-SETUP-COMPLETE] Generated activation_token ${getLineNum()}`);

    const authUrl = buildActivationAuthUrl({
      state,
      codeChallenge,
      activationToken,
      nonce,
      identifier,
      redirectUri: FRONTEND_REDIRECT_URI,
      clientId: KEYCLOAK_CLIENT_ID
    });

    console.log(`[PASSWORD-SETUP-COMPLETE] Auth URL generated: ${authUrl.substring(0, 100)}... ${getLineNum()}`);

    // ── STEP 6: Clean up transaction ──
    await txnStore.delete(txnId);

    console.log(`[PASSWORD-SETUP-COMPLETE] Setup flow initiated for ${maskIdentifier(identifier)} ${getLineNum()}`);

    return res.json({
      flow: 'ACTIVATION_REQUIRED',
      authUrl,
      state,
      codeChallenge,
      message: 'Redirect to authUrl to complete password setup'
    });

  } catch (err) {
    console.error(`[PASSWORD-SETUP-COMPLETE] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
