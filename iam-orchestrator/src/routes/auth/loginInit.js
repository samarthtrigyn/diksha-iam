import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { generatePKCE } from '../../utils/pkce.js';
import { resolveCanonicalUser } from '../../services/iamUser.js';
import { getAdminToken, upsertKeycloakUserFromIamUser } from '../../services/keycloak.js';
import { sendOtp } from '../../services/otp.js';
import { getClient, isRedirectUriAllowed, getChannelType } from '../../config/clients.js';
import mappingStore from '../../stores/mappingStore.js';
import txnStore from '../../stores/txnStore.js';
import { validateLoginInit } from '../../middleware/validation.js';

const router = Router();

/**
 * POST /iam/auth/login/init
 * 
 * Start login transaction. Initializes OIDC flow with proper client validation.
 * For ACTIVE users: generates PKCE + nonce, redirects to /iam/oauth2/authorize
 * For FIRST-TIME users: sends OTP, redirects to /iam/auth/otp/verify
 * 
 * Request:
 *   - identifier (required): email/phone/username
 *   - clientId (required): registered client ID
 *   - redirectUri (required): registered redirect URI for this client
 *   - channel (optional): 'WEB' or 'MOBILE' (inferred from redirectUri if not provided)
 * 
 * Response (ACTIVE user):
 *   {
 *     "txnId": "uuid",
 *     "status": "LOGIN_ALLOWED",
 *     "nextStep": "REDIRECT",
 *     "redirectUrl": "/iam/oauth2/authorize?txnId=..."
 *   }
 * 
 * Response (FIRST-TIME user):
 *   {
 *     "txnId": "uuid",
 *     "status": "OTP_SENT",
 *     "nextStep": "VERIFY_OTP",
 *     "maskedIdentifier": "ra***@example.com",
 *     "resendAfterSeconds": 60
 *   }
 */
router.post('/iam/auth/login/init', validateLoginInit, async (req, res) => {
  try {
    const { identifier, clientId, redirectUri, channel: clientChannel } = req.body;

    console.log(
      `[AUTH-LOGIN-INIT] clientId=${clientId}, identifier=${maskIdentifier(identifier)} ${getLineNum()}`
    );

    // ── STEP 1: Validate clientId ──
    const client = getClient(clientId);
    if (!client) {
      console.warn(`[AUTH-LOGIN-INIT] Invalid clientId: ${clientId} ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_client',
        errorDescription: `Client '${clientId}' not registered`,
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // ── STEP 2: Validate redirectUri ──
    if (!redirectUri || !isRedirectUriAllowed(clientId, redirectUri)) {
      console.warn(`[AUTH-LOGIN-INIT] Invalid redirectUri for ${clientId}: ${redirectUri} ${getLineNum()}`);
      return res.status(400).json({
        error: 'invalid_request',
        errorDescription: 'redirectUri not allowed for this client',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }
    
    const txnId = uuidv4(); //Creating a new Login Attempt transaction ID for this login attempt. This will be used to track the state across multiple steps (OTP verification, authorization, callback).
    
    // ── STEP 3: Resolve canonical user ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      console.warn(`[AUTH-LOGIN-INIT] User not found: ${maskIdentifier(identifier)} ${getLineNum()}`);
      
      // TODO: Return the registration URL with proper query parameters if user is not found, instead of just an error. This allows the client to seamlessly redirect to registration if needed.

      return res.status(404).json({
        error: 'user_not_found',
        errorDescription: 'User not found',
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`[AUTH-LOGIN-INIT] User resolved: ${JSON.stringify(iamUser)} ${getLineNum()}`);
    }

    if (iamUser.status === 'INACTIVE') //0 means inactive user, 1 means active user. This is to handle the case where the user is present in IAM but is inactive. We can choose to return a different error message or code for this case if needed.
    {
      console.warn(`[AUTH-LOGIN-INIT] User is inactive: ${maskIdentifier(identifier)} ${getLineNum()}`);
      return res.status(403).json({
        error: 'user_inactive',
        errorDescription: 'User account is inactive. Please contact support.',
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    const username = iamUser.username;
    console.log(`[AUTH-LOGIN-INIT] Resolved user: ${iamUserId} (${username}) ${getLineNum()}`);

    // ── STEP 4: Determine channel (WEB or MOBILE) ──
    const channel = clientChannel || getChannelType(clientId, redirectUri);
    console.log(`[AUTH-LOGIN-INIT] Channel: ${channel} ${getLineNum()}`);

    // ── STEP 5: Check activation status ──
    let activationStatus = null;
    try {
      const mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus;
      // if(iamUserId === '79350233-b549-451e-aece-622df02fb874'){
      //   activationStatus = 'ACTIVE';
      // }
      console.log(`[AUTH-LOGIN-INIT] Activation status: ${activationStatus || 'NEW'} ${getLineNum()}`);
    } catch (mapErr) {
      console.warn(`[AUTH-LOGIN-INIT] Mapping lookup failed ${getLineNum()}:`, mapErr.message);
    }

    // ── STEP 6: ACTIVE user path: generate PKCE + nonce, return authorize URL ──
    if (activationStatus === 'ACTIVE') {
      console.log(`[AUTH-LOGIN-INIT] User ACTIVE → LOGIN_ALLOWED flow ${getLineNum()}`);

      
      const { codeVerifier, codeChallenge } = generatePKCE();
      const nonce = uuidv4();
      
      //--Setting the Login attempted transaction State for Active User path
      await txnStore.set(txnId, {
        txnId,
        identifier,
        iamUserId,
        username,
        flow: 'ACTIVE_USER',
        status: 'LOGIN_ALLOWED',
        clientId,
        redirectUri,
        'kcCallbackUrl': `${process.env.ORCHESTRATOR_BASE_URL}/iam/auth/callback`, // For Keycloak to redirect back after login
        channel,
        codeVerifier,
        codeChallenge,
        nonce,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      console.log(`[AUTH-LOGIN-INIT] Transaction created: ${txnId} (ACTIVE_USER) ${getLineNum()}`);

      return res.status(200).json({
        txnId,
        status: 'LOGIN_ALLOWED',
        nextStep: 'REDIRECT',
        redirectUrl: `/iam/oauth2/authorize?txnId=${txnId}`
      });
    }

    // ── STEP 7: FIRST-TIME user path: send OTP, return OTP verification URL ──
    if (!activationStatus || activationStatus === 'PASSWORD_SETUP_REQUIRED' || activationStatus === 'PASSWORD_SETUP_INITIATED') {
      console.log(`[AUTH-LOGIN-INIT] User ${activationStatus || 'NEW'} → OTP_SENT flow ${getLineNum()}`);

      // Upsert Keycloak user
      try {
        const adminToken = await getAdminToken();
        await upsertKeycloakUserFromIamUser(iamUser, adminToken);
        console.log(`[AUTH-LOGIN-INIT] Keycloak user upserted: ${iamUserId} ${getLineNum()}`);
      } catch (kcErr) {
        console.error(`[AUTH-LOGIN-INIT] Keycloak upsert failed ${getLineNum()}:`, kcErr.message);
        return res.status(500).json({
          error: 'service_unavailable',
          errorDescription: 'Failed to prepare user account',
          statusCode: 500,
          timestamp: new Date().toISOString()
        });
      }

      // Update mapping to reflect password setup requirement
      //TODO save the status in the User table using user service. 
      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          username,
          activationStatus: 'PASSWORD_SETUP_REQUIRED',
          updatedAt: Date.now()
        });
      } catch (mapErr) {
        console.warn(`[AUTH-LOGIN-INIT] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      // Send OTP
      let txnIdFromOtp, otpResponse;
      try {
        const otpResp = await sendOtp(identifier);
        txnIdFromOtp = otpResp.data.result.txnId;
        otpResponse = otpResp.data.result;
        console.log(`[AUTH-LOGIN-INIT] OTP sent, txnId: ${txnIdFromOtp} ${getLineNum()}`);
      } catch (otpErr) {
        console.error(`[AUTH-LOGIN-INIT] OTP send failed ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
        return res.status(500).json({
          error: 'service_unavailable',
          errorDescription: 'Failed to send OTP',
          statusCode: 500,
          timestamp: new Date().toISOString()
        });
      }

      // Store transaction with OTP_SENT status (no PKCE yet; will be generated at /otp/verify)
      await txnStore.set(txnId, {
        txnId,
        txnIdFromOtp,
        otpResponse,
        identifier,
        iamUserId,
        username,
        flow: 'FIRST_TIME_USER',
        status: 'OTP_SENT',
        clientId,
        redirectUri,
        'kcCallbackUrl': `${process.env.ORCHESTRATOR_BASE_URL}/iam/auth/callback`, // For Keycloak to redirect back after login
        channel,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      console.log(`[AUTH-LOGIN-INIT] Transaction created: ${txnId} (FIRST_TIME_USER) ${getLineNum()}`);

      // Mask identifier for response
      let maskedIdentifier = identifier;
      if (identifier.includes('@')) {
        // Email: show first 2 chars + *** + @domain
        const [local, domain] = identifier.split('@');
        maskedIdentifier = `${local.substring(0, 2)}***@${domain}`;
      } else if (/^\d{10}$/.test(identifier)) {
        // Phone: show first 2 + **** + last 2 digits
        maskedIdentifier = `${identifier.substring(0, 2)}****${identifier.substring(8)}`;
      }

      return res.status(200).json({
        txnId,
        status: 'OTP_SENT',
        nextStep: 'VERIFY_OTP',
        maskedIdentifier,
        resendAfterSeconds: 60
      });
    }

    // Fallback: unknown status
    return res.status(400).json({
      error: 'invalid_state',
      errorDescription: 'Unable to determine user activation status',
      statusCode: 400,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(`[AUTH-LOGIN-INIT] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
