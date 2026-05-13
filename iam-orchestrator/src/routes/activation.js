import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { KEYCLOAK_CLIENT_ID, FRONTEND_REDIRECT_URI } from '../config/index.js';
import { getLineNum, maskIdentifier } from '../utils/helpers.js';
import { generatePKCE } from '../utils/pkce.js';
import { generateActivationToken } from '../utils/token.js';
import { buildActivationAuthUrl } from '../utils/auth.js';
import { verifyOtp } from '../services/otp.js';
import mappingStore from '../stores/mappingStore.js';
import txnStore from '../stores/txnStore.js';
import stateStore from '../stores/stateStore.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/activation/verify-otp
// ──────────────────────────────────────────────────────────────────────────────
router.post('/iam/activation/verify-otp', async (req, res) => {
  try {
    const { txnId, otp } = req.body;

    if (!txnId || !otp) {
      return res.status(400).json({ error: 'txnId and otp are required' });
    }

    console.log(`[OTP] /iam/activation/verify-otp – txnId: ${txnId} ${getLineNum()}`);

    // ── STEP 1: Retrieve transaction data from Redis ──
    const txnData = await txnStore.get(txnId);
    if (!txnData || Date.now() > txnData.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired transaction' });
    }

    const { identifier, iamUserId } = txnData;
    console.log(`[OTP] Transaction retrieved: identifier=${maskIdentifier(identifier)}, iamUserId=${iamUserId} ${getLineNum()}`);

    // ── STEP 2: Verify OTP ──
    try {
      const verifyResp = await verifyOtp(identifier, otp);

      const st = verifyResp.data?.params?.status || verifyResp.data?.result?.response;
      if (st !== 'SUCCESS') return res.status(400).json({ error: 'OTP verification failed' });
    } catch (otpErr) {
      const data    = otpErr.response?.data;
      const errMsg  = data?.params?.errmsg || data?.message || 'OTP verification failed';
      const remaining = data?.result?.remainingAttempt;
      return res.status(400).json({ error: errMsg, ...(remaining != null && { remainingAttempts: remaining }) });
    }

    console.log(`[OTP] OTP verified for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 3: Generate PKCE and state (server-side) ──
    const { codeChallenge, codeVerifier } = generatePKCE();
    const state = uuidv4();
    const nonce = uuidv4();
    const redirectUri = FRONTEND_REDIRECT_URI;

    // ── STEP 4: Update mapping status to PASSWORD_SETUP_INITIATED ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        username: txnData.username || '',
        activationStatus: 'PASSWORD_SETUP_INITIATED',
        updatedAt: Date.now()
      });
      console.log(`[OTP] Mapping updated to PASSWORD_SETUP_INITIATED for ${iamUserId} ${getLineNum()}`);
    } catch (mapErr) {
      console.warn(`[OTP] Failed to update mapping ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 5: Store state with PKCE code_verifier (server-side only) ──
    await stateStore.set(state, {
      identifier,
      iamUserId,
      codeVerifier,
      nonce,
      activationStatus: 'PASSWORD_SETUP_INITIATED',
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[OTP] State stored with PKCE: ${state} ${getLineNum()}`);

    // ── STEP 6: Generate activation token and build Keycloak authorization URL ──
    // The activation token tells the custom Keycloak authenticator to skip the
    // login form and go directly to the UPDATE_PASSWORD required action page.
    // Use Keycloak username as identifier so resolveUser() can find the user by username
    const kcIdentifier = txnData.username || identifier;
    const activationToken = generateActivationToken({ identifier: kcIdentifier, iamUserId });
    console.log(`[OTP] Generated activation token for ${maskIdentifier(identifier)} (kcUsername: ${kcIdentifier}) ${getLineNum()}`);

    const keycloakAuthUrl = buildActivationAuthUrl({
      state,
      nonce,
      codeChallenge,
      identifier: kcIdentifier,
      activationToken,
      redirectUri,
      clientId: KEYCLOAK_CLIENT_ID
    });

    console.log(`[OTP] Built activation authUrl for ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 7: Clean up transaction and return response ──
    await txnStore.delete(txnId);

    const response = {
      flow: 'SET_PASSWORD',
      authUrl: keycloakAuthUrl,
      state
    };

    console.log(`[OTP] Returning activation response ${getLineNum()}`);
    return res.json(response);

  } catch (err) {
    console.error(`[OTP] Error ${getLineNum()}:`, err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
