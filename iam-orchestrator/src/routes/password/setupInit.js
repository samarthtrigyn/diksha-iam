import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { resolveCanonicalUser } from '../../services/iamUser.js';
import { getAdminToken, upsertKeycloakUserFromIamUser } from '../../services/keycloak.js';
import { sendOtp } from '../../services/otp.js';
import mappingStore from '../../stores/mappingStore.js';
import txnStore from '../../stores/txnStore.js';

const router = Router();

/**
 * POST /iam/password/setup/init
 * 
 * Start password setup for new/legacy users
 * This is a wrapper around the OTP flow (calls /iam/auth/login/init internally)
 * 
 * Request:
 *   - identifier (required): email/phone/username
 * 
 * Response:
 *   - flow: 'OTP_VERIFICATION'
 *   - txnId: transaction ID
 *   - otpResponse: OTP response details
 */
router.post('/iam/password/setup/init', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'identifier is required',
        statusCode: 400
      });
    }

    console.log(`[PASSWORD-SETUP-INIT] identifier: ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 1: Resolve canonical user ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      console.warn(`[PASSWORD-SETUP-INIT] User not found: ${maskIdentifier(identifier)} ${getLineNum()}`);
      return res.status(404).json({
        error: 'user_not_found',
        errorDescription: 'User not found',
        statusCode: 404
      });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    console.log(`[PASSWORD-SETUP-INIT] Resolved user: ${iamUserId} (username: ${iamUser.username}) ${getLineNum()}`);

    // ── STEP 2: Check activation status ──
    let activationStatus = null;
    try {
      const mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus;
      console.log(`[PASSWORD-SETUP-INIT] Activation status: ${activationStatus || 'new'} ${getLineNum()}`);
    } catch (mapErr) {
      console.warn(`[PASSWORD-SETUP-INIT] Mapping lookup failed ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 3: For password setup, require new/setup status (not ACTIVE) ──
    if (activationStatus === 'ACTIVE') {
      console.warn(`[PASSWORD-SETUP-INIT] User is already ACTIVE, cannot initiate password setup ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_state',
        errorDescription: 'User is already active. Use /iam/auth/login/password instead.',
        statusCode: 400
      });
    }

    // ── STEP 4: Ensure Keycloak user exists ──
    try {
      const adminToken = await getAdminToken();
      await upsertKeycloakUserFromIamUser(iamUser, adminToken);
      console.log(`[PASSWORD-SETUP-INIT] Keycloak user upserted: ${iamUserId} ${getLineNum()}`);
    } catch (kcErr) {
      console.error(`[PASSWORD-SETUP-INIT] Failed to upsert Keycloak user ${getLineNum()}:`, kcErr.message);
      return res.status(500).json({
        error: 'service_unavailable',
        errorDescription: 'Failed to prepare user account',
        statusCode: 500
      });
    }

    // ── STEP 5: Update mapping ──
    try {
      await mappingStore.set(iamUserId, {
        iamUserId,
        username: iamUser.username,
        activationStatus: activationStatus || 'PASSWORD_SETUP_REQUIRED',
        updatedAt: Date.now()
      });
    } catch (mapErr) {
      console.warn(`[PASSWORD-SETUP-INIT] Failed to update mapping ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 6: Send OTP ──
    let txnId, otpResp;
    try {
      const sendResp = await sendOtp(identifier);
      txnId = sendResp.data.result.txnId;
      otpResp = sendResp.data.result;
      console.log(`[PASSWORD-SETUP-INIT] OTP sent, txnId: ${txnId} ${getLineNum()}`);
    } catch (otpErr) {
      console.error(`[PASSWORD-SETUP-INIT] Failed to send OTP ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
      return res.status(500).json({
        error: 'service_unavailable',
        errorDescription: 'Failed to send OTP',
        statusCode: 500
      });
    }

    // ── STEP 7: Store transaction (mark as PASSWORD_SETUP flow) ──
    await txnStore.set(txnId, {
      identifier,
      username: iamUser.username,
      iamUserId,
      txnId,
      flow: 'PASSWORD_SETUP',
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[PASSWORD-SETUP-INIT] Transaction stored: ${txnId} ${getLineNum()}`);

    return res.json({
      flow: 'PASSWORD_SETUP',
      txnId,
      otpResponse: otpResp
    });

  } catch (err) {
    console.error(`[PASSWORD-SETUP-INIT] Error ${getLineNum()}:`, err.response?.data || err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
