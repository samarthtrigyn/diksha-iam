import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { buildActivationAuthUrl, buildLoginAuthUrl } from '../../utils/auth.js';
import txnStore from '../../stores/txnStore.js';
import stateStore from '../../stores/stateStore.js';
import { validateAuthorize } from '../../middleware/validation.js';

const router = Router();

/**
 * GET /iam/oauth2/authorize
 *
 * IAM-internal authorization bridge endpoint.
 * Clients never see the real Keycloak authorization URL.
 * This endpoint generates Keycloak auth URL with PKCE, nonce, and (for first-time users) activation_token.
 * Then performs a 302 redirect to Keycloak.
 *
 * Query Parameters:
 *   - txnId (required): Transaction ID from loginInit or otpVerify
 *
 * Response:
 *   - HTTP 302 to Keycloak authorization URL
 *     For ACTIVE users: /realms/{realm}/protocol/openid-connect/auth?...
 *     For FIRST_TIME users: /realms/{realm}/protocol/openid-connect/auth?...&activation_token=...
 *
 * Error:
 *   - 400: txnId invalid/expired/wrong status
 *   - 500: Server error
 */
router.get('/iam/oauth2/authorize', validateAuthorize, async (req, res) => {
  try {
    const { txnId } = req.query;

    console.log(`[OAUTH2-AUTHORIZE] txnId: ${txnId} ${getLineNum()}`);

    // ── STEP 1: Load transaction ──
    const txnData = await txnStore.get(txnId);
    if (!txnData) {
      console.warn(`[OAUTH2-AUTHORIZE] Transaction not found: ${txnId} ${getLineNum()}`);
      return res.status(400).json({
        error: 'txn_not_found',
        errorDescription: 'Transaction not found or expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Check expiry
    if (Date.now() > txnData.expiresAt) {
      console.warn(`[OAUTH2-AUTHORIZE] Transaction expired: ${txnId} ${getLineNum()}`);
      await txnStore.delete(txnId);
      return res.status(400).json({
        error: 'txn_expired',
        errorDescription: 'Transaction expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Check status (must be LOGIN_ALLOWED or OTP_VERIFIED)
    const { status, flow, identifier, iamUserId, username, clientId, redirectUri, channel, kcCallbackUrl } = txnData;
    if (!['LOGIN_ALLOWED', 'OTP_VERIFIED'].includes(status)) {
      console.warn(
        `[OAUTH2-AUTHORIZE] Invalid status: ${status} (expected LOGIN_ALLOWED or OTP_VERIFIED) ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'invalid_status',
        errorDescription: `Cannot authorize in state: ${status}`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    console.log(
      `[OAUTH2-AUTHORIZE] Processing ${flow} flow (${status}) for username::${maskIdentifier(username)} for user ${maskIdentifier(identifier)} ${getLineNum()}`
    );

    // ── STEP 2: Generate state (not stored at loginInit; generated here for retry support) ──
    const state = uuidv4();
    console.log(`[OAUTH2-AUTHORIZE] Generated state: ${state} ${getLineNum()}`);

    // ── STEP 3: Store state → txnId mapping (simplified schema) ──
    await stateStore.set(state, {
      txnId,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[OAUTH2-AUTHORIZE] State stored: ${state} → ${txnId} ${getLineNum()}`);

    // ── STEP 4: Build Keycloak auth URL (flow-specific) ──
    let keycloakAuthUrl;

    if (status === 'OTP_VERIFIED' && flow === 'FIRST_TIME_USER') {
      // First-time user with activation_token
      const { codeChallenge, nonce, activationToken } = txnData;

      keycloakAuthUrl = buildActivationAuthUrl({
        state,
        nonce,
        codeChallenge,
        identifier: username,  // Pass username for login_hint parameter
        activationToken,
        redirectUri: kcCallbackUrl, // Use the callback URL stored in txnData
        clientId
      });

      console.log(
        `[OAUTH2-AUTHORIZE] Built activation auth URL (with activation_token) ${getLineNum()}`
      );
    } else if (status === 'LOGIN_ALLOWED' && flow === 'ACTIVE_USER') {
      // Active user, normal OIDC flow
      const { codeChallenge, nonce } = txnData;

      keycloakAuthUrl = buildLoginAuthUrl({
        state,
        nonce,
        codeChallenge,
        identifier: username,  // Pass username for login_hint parameter
        redirectUri: kcCallbackUrl, // Use the callback URL stored in txnData
        clientId
      });

      console.log(`[OAUTH2-AUTHORIZE] Built standard login auth URL ${getLineNum()}`);
    } else {
      // Should not reach here due to status check above
      console.error(
        `[OAUTH2-AUTHORIZE] Unexpected flow/status combo: ${flow}/${status} ${getLineNum()}`
      );
      return res.status(500).json({
        error: 'server_error',
        errorDescription: 'Unexpected flow state',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 5: Update transaction status to IAM_AUTHORIZE_READY ──
    txnData.status = 'IAM_AUTHORIZE_READY';
    await txnStore.set(txnId, txnData);

    console.log(
      `[OAUTH2-AUTHORIZE] Redirecting to Keycloak: ${keycloakAuthUrl.substring(0, 80)}... ${getLineNum()}`
    );

    // ── STEP 6: Redirect to Keycloak ──
    return res.redirect(302, keycloakAuthUrl);

  } catch (err) {
    console.error(`[OAUTH2-AUTHORIZE] Unexpected error ${getLineNum()}:`, err.stack || err);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
