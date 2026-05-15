import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { generatePKCE } from '../../utils/pkce.js';
import { generateActivationToken } from '../../utils/token.js';
import { verifyOtp } from '../../services/otp.js';
import txnStore from '../../stores/txnStore.js';
import { validateOtpVerify } from '../../middleware/validation.js';

const router = Router();

/**
 * POST /iam/auth/otp/verify
 *
 * Verify OTP for first-time users and prepare for Keycloak activation flow.
 * 
 * Request:
 *   - txnId (required): From POST /iam/auth/login/init (first-time user)
 *   - otp (required): 4-8 digit OTP
 *
 * Response (Success):
 *   {
 *     "txnId": "uuid",
 *     "status": "OTP_VERIFIED",
 *     "nextStep": "REDIRECT",
 *     "redirectUrl": "/iam/oauth2/authorize?txnId=..."
 *   }
 *
 * Response (Error):
 *   - error, errorDescription, statusCode
 */
router.post('/iam/auth/otp/verify', validateOtpVerify, async (req, res) => {
  try {
    const { txnId, otp } = req.body;

    console.log(`[AUTH-OTP-VERIFY] txnId: ${txnId}, otp: ******* ${getLineNum()}`);

    // ── STEP 1: Load and validate transaction ──
    const txnData = await txnStore.get(txnId);
    if (!txnData) {
      console.warn(`[AUTH-OTP-VERIFY] Transaction not found: ${txnId} ${getLineNum()}`);
      return res.status(404).json({
        error: 'txn_not_found',
        errorDescription: 'Transaction not found or expired',
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
    }

    // Check transaction expiry
    if (Date.now() > txnData.expiresAt) {
      console.warn(`[AUTH-OTP-VERIFY] Transaction expired: ${txnId} ${getLineNum()}`);
      await txnStore.delete(txnId);
      return res.status(400).json({
        error: 'txn_expired',
        errorDescription: 'Transaction expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Check flow and status
    if (txnData.flow !== 'FIRST_TIME_USER') {
      console.warn(
        `[AUTH-OTP-VERIFY] Invalid flow: ${txnData.flow} (expected FIRST_TIME_USER) ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'invalid_flow',
        errorDescription: 'This transaction is not for first-time user OTP verification',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    if (txnData.status !== 'OTP_SENT') {
      console.warn(
        `[AUTH-OTP-VERIFY] Invalid status: ${txnData.status} (expected OTP_SENT) ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'invalid_status',
        errorDescription: `OTP already verified or in unexpected state: ${txnData.status}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    const { identifier, iamUserId, username, clientId, redirectUri, channel } = txnData;
    console.log(
      `[AUTH-OTP-VERIFY] Processing OTP for ${maskIdentifier(identifier)} (${iamUserId}) ${getLineNum()}`
    );

    // ── STEP 2: Verify OTP ──
    try {
      await verifyOtp(identifier, otp);
      console.log(`[AUTH-OTP-VERIFY] OTP verified successfully for ${maskIdentifier(identifier)} ${getLineNum()}`);
    } catch (otpErr) {
      console.warn(
        `[AUTH-OTP-VERIFY] OTP verification failed ${getLineNum()}:`,
        otpErr.response?.data || otpErr.message
      );
      return res.status(401).json({
        error: 'invalid_otp',
        errorDescription: 'Invalid or expired OTP',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 3: Generate PKCE + nonce ──
    const { codeVerifier, codeChallenge } = generatePKCE();
    const nonce = uuidv4();
    const activationToken = generateActivationToken(username, iamUserId);

    console.log(
      `[AUTH-OTP-VERIFY] Generated PKCE, nonce, and activation_token ${getLineNum()}`
    );

    // ── STEP 4: Update transaction with OTP_VERIFIED status and PKCE data ──
    await txnStore.set(txnId, {
      txnId,
      identifier,
      iamUserId,
      username,
      flow: 'FIRST_TIME_USER',
      status: 'OTP_VERIFIED',
      clientId,
      redirectUri,
      'kcCallbackUrl': `${process.env.ORCHESTRATOR_BASE_URL}/iam/auth/callback`, // For Keycloak to redirect back after login
      channel,
      codeVerifier,
      codeChallenge,
      nonce,
      activationToken,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[AUTH-OTP-VERIFY] Transaction updated: ${txnId} (OTP_VERIFIED) ${getLineNum()}`);

    return res.status(200).json({
      txnId,
      status: 'OTP_VERIFIED',
      nextStep: 'REDIRECT',
      redirectUrl: `/iam/oauth2/authorize?txnId=${txnId}`
    });

  } catch (err) {
    console.error(`[AUTH-OTP-VERIFY] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
