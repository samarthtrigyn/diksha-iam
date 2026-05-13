import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLineNum, isEmail, maskIdentifier } from '../../utils/helpers.js';
import { resolveCanonicalUser } from '../../services/iamUser.js';
import { getAdminToken, upsertKeycloakUserFromIamUser } from '../../services/keycloak.js';
import { sendOtp } from '../../services/otp.js';
import mappingStore from '../../stores/mappingStore.js';
import txnStore from '../../stores/txnStore.js';

const router = Router();

/**
 * POST /iam/auth/login/init
 * 
 * Start login transaction. Accepts identifier (username/email/mobile).
 * Creates txnId and returns flow type (DIRECT_GRANT or OTP_VERIFICATION).
 * 
 * Request:
 *   - identifier (required): email/phone/username
 *   - clientId (optional): client identifier (for client-specific policies)
 *   - redirectUri (optional): client redirect URI
 * 
 * Response (ACTIVE user):
 *   - flow: 'DIRECT_GRANT'
 *   - txnId: transaction ID
 *   - message: 'User is active. Proceed to login/password endpoint.'
 * 
 * Response (New/Password setup user):
 *   - flow: 'OTP_VERIFICATION'
 *   - txnId: transaction ID
 *   - otpResponse: OTP response details
 */
router.post('/iam/auth/login/init', async (req, res) => {
  try {
    const { identifier, clientId, redirectUri } = req.body;

    if (!identifier) {
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'identifier is required',
        statusCode: 400
      });
    }

    console.log(`[AUTH-LOGIN-INIT] identifier: ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 1: Resolve canonical user from identifier ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      console.warn(`[AUTH-LOGIN-INIT] User not found: ${maskIdentifier(identifier)} ${getLineNum()}`);
      return res.status(404).json({
        error: 'user_not_found',
        errorDescription: 'User not found',
        statusCode: 404
      });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    console.log(`[AUTH-LOGIN-INIT] Resolved user: ${iamUserId} (username: ${iamUser.username}) ${getLineNum()}`);

    // ── STEP 2: Check activation status ──
    let activationStatus = null;
    try {
      const mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus;
      console.log(`[AUTH-LOGIN-INIT] Activation status: ${activationStatus || 'new'} ${getLineNum()}`);
    } catch (mapErr) {
      console.warn(`[AUTH-LOGIN-INIT] Mapping lookup failed ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 3: Determine flow based on activation status ──
    
    // ACTIVE user: Can use direct grant (password)
    if (activationStatus === 'ACTIVE') {
      console.log(`[AUTH-LOGIN-INIT] User is ACTIVE → DIRECT_GRANT flow ${getLineNum()}`);

      const txnId = uuidv4();
      await txnStore.set(txnId, {
        identifier,
        username: iamUser.username,
        iamUserId,
        txnId,
        flow: 'DIRECT_GRANT',
        clientId,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      return res.json({
        flow: 'DIRECT_GRANT',
        txnId,
        message: 'User is active. Proceed to /iam/auth/login/password endpoint.'
      });
    }

    // NEW, PASSWORD_SETUP_REQUIRED, or PASSWORD_SETUP_INITIATED: Use OTP flow
    if (!activationStatus || activationStatus === 'PASSWORD_SETUP_REQUIRED' || activationStatus === 'PASSWORD_SETUP_INITIATED') {
      console.log(`[AUTH-LOGIN-INIT] User status: ${activationStatus || 'NEW'} → OTP_VERIFICATION flow ${getLineNum()}`);

      // Create/update Keycloak user
      try {
        const adminToken = await getAdminToken();
        await upsertKeycloakUserFromIamUser(iamUser, adminToken);
        console.log(`[AUTH-LOGIN-INIT] Keycloak user upserted: ${iamUserId} ${getLineNum()}`);
      } catch (kcErr) {
        console.error(`[AUTH-LOGIN-INIT] Failed to upsert Keycloak user ${getLineNum()}:`, kcErr.message);
        return res.status(500).json({
          error: 'service_unavailable',
          errorDescription: 'Failed to prepare user account',
          statusCode: 500
        });
      }

      // Update mapping
      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          username: iamUser.username,
          activationStatus: activationStatus || 'PASSWORD_SETUP_REQUIRED',
          updatedAt: Date.now()
        });
      } catch (mapErr) {
        console.warn(`[AUTH-LOGIN-INIT] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      // Send OTP
      let txnId, otpResp;
      try {
        const sendResp = await sendOtp(identifier);
        txnId = sendResp.data.result.txnId;
        otpResp = sendResp.data.result;
        console.log(`[AUTH-LOGIN-INIT] OTP sent, txnId: ${txnId} ${getLineNum()}`);
      } catch (otpErr) {
        console.error(`[AUTH-LOGIN-INIT] Failed to send OTP ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
        return res.status(500).json({
          error: 'service_unavailable',
          errorDescription: 'Failed to send OTP',
          statusCode: 500
        });
      }

      // Store transaction
      await txnStore.set(txnId, {
        identifier,
        username: iamUser.username,
        iamUserId,
        txnId,
        flow: 'OTP_VERIFICATION',
        clientId,
        redirectUri,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      console.log(`[AUTH-LOGIN-INIT] Transaction stored: ${txnId} ${getLineNum()}`);

      return res.json({
        flow: 'OTP_VERIFICATION',
        txnId,
        otpResponse: otpResp
      });
    }

    return res.status(400).json({
      error: 'invalid_state',
      errorDescription: 'Unable to determine user status',
      statusCode: 400
    });

  } catch (err) {
    console.error(`[AUTH-LOGIN-INIT] Error ${getLineNum()}:`, err.response?.data || err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
