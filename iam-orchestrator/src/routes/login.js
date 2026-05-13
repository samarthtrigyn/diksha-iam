import { Router } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  KEYCLOAK_URL, KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID
} from '../config/index.js';
import { getLineNum, isEmail, maskIdentifier } from '../utils/helpers.js';
import { validateTokenClaims } from '../utils/token.js';
import { resolveCanonicalUser } from '../services/iamUser.js';
import { getAdminToken, upsertKeycloakUserFromIamUser, logKeycloakCall } from '../services/keycloak.js';
import { sendOtp } from '../services/otp.js';
import mappingStore from '../stores/mappingStore.js';
import txnStore from '../stores/txnStore.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/login/start
// ──────────────────────────────────────────────────────────────────────────────
router.post('/iam/login/start', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) return res.status(400).json({ error: 'identifier is required' });

    console.log(`[LOGIN] /iam/login/start – identifier: ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 1: Resolve canonical user from identifier (email/phone/username) ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    console.log(`[LOGIN] Resolved canonical user: ${iamUserId} (username: ${iamUser.username}) ${getLineNum()}`);

    // ── STEP 2: Check activation status from mappingStore ──
    let mapping = null;
    let activationStatus = null;
    try {
      mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus;
      console.log(`[LOGIN] Activation status from mapping: ${activationStatus || 'not yet set'} ${getLineNum()}`);
    } catch (cacheErr) {
      console.warn(`[LOGIN] Mapping lookup failed ${getLineNum()}:`, cacheErr.message);
    }

    // ── ACTIVE user → Direct Grant (password authenticated server-side, no redirect) ──
    if (activationStatus === 'ACTIVE') {
      console.log(`[LOGIN] User is ACTIVE, attempting Direct Grant ${getLineNum()}`);

      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ flow: 'PASSWORD_REQUIRED', error: 'Password is required' });
      }

      const tokenEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
      let tokenResp;
      try {
        console.log(`[KEYCLOAK-REQ] POST ${tokenEndpoint} (grant_type: password, username: ${iamUser.username}) ${getLineNum()}`);
        tokenResp = await axios.post(
          `${KEYCLOAK_URL}${tokenEndpoint}`,
          new URLSearchParams({
            grant_type: 'password',
            client_id:  KEYCLOAK_CLIENT_ID,
            username:   iamUser.username,
            password,
            scope:         'openid profile email'
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            validateStatus: s => s < 500
          }
        );
      } catch (err) {
        logKeycloakCall('POST', tokenEndpoint, err.response?.status || 'ERROR', null, err);
        return res.status(500).json({ error: 'Authentication service unavailable' });
      }

      logKeycloakCall('POST', tokenEndpoint, tokenResp.status, `access_token: ${tokenResp.data.access_token ? 'granted' : 'null'}`);

      if (tokenResp.status !== 200 || !tokenResp.data.access_token) {
        const kcError = tokenResp.data?.error_description || tokenResp.data?.error || 'Invalid credentials';
        return res.status(401).json({ error: kcError });
      }

      const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
      let idTokenPayload;
      try {
        idTokenPayload = validateTokenClaims(tokenResp.data.id_token, null, expectedIssuer, KEYCLOAK_CLIENT_ID);
        console.log(`[LOGIN] ID token validated for subject: ${idTokenPayload.sub} ${getLineNum()}`);
      } catch (validateErr) {
        console.error(`[LOGIN] Token validation failed ${getLineNum()}:`, validateErr.message);
        return res.status(401).json({ error: `Token validation failed: ${validateErr.message}` });
      }

      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          username: iamUser.username,
          activationStatus: 'ACTIVE',
          updatedAt: Date.now()
        });
      } catch (mapErr) {
        console.warn(`[LOGIN] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      console.log(`[LOGIN] Direct Grant success for ${maskIdentifier(identifier)} ${getLineNum()}`);

      return res.json({
        flow: 'AUTHENTICATED',
        user: {
          id:        idTokenPayload.sub,
          username:  idTokenPayload.preferred_username,
          email:     idTokenPayload.email,
          name:      idTokenPayload.name,
          iamUserId: idTokenPayload.iamUserId || idTokenPayload.iam_user_id || iamUserId
        },
        tokens: {
          accessToken:  tokenResp.data.access_token,
          idToken:      tokenResp.data.id_token,
          refreshToken: tokenResp.data.refresh_token,
          expiresIn:    tokenResp.data.expires_in,
          tokenType:    tokenResp.data.token_type
        },
        roles:            idTokenPayload.realm_access?.roles || [],
        clientRoles:      idTokenPayload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || [],
        activationStatus: 'ACTIVE'
      });
    }

    // ── NEW, PASSWORD_SETUP_REQUIRED, or PASSWORD_SETUP_INITIATED user → initiate OTP flow ──
    // PASSWORD_SETUP_INITIATED means the user started but never completed password setup;
    // we allow them to restart the OTP flow rather than leaving them stuck.
    if (!activationStatus || activationStatus === 'PASSWORD_SETUP_REQUIRED' || activationStatus === 'PASSWORD_SETUP_INITIATED') {
      console.log(`[LOGIN] User status: ${activationStatus || 'NEW'}, initiating OTP flow ${getLineNum()}`);

      // Create/update Keycloak user with canonical username and IAM attributes
      try {
        const adminToken = await getAdminToken();
        console.log(`[LOGIN] Obtained admin token, upserting Keycloak user ${getLineNum()}`);
        await upsertKeycloakUserFromIamUser(iamUser, adminToken);
        console.log(`[LOGIN] Keycloak user upserted: ${iamUserId} ${getLineNum()}`);
      } catch (kcErr) {
        console.error(`[LOGIN] Failed to upsert Keycloak user ${getLineNum()}:`, kcErr.message);
        return res.status(500).json({ error: 'Failed to prepare user account' });
      }

      // Update/create mapping for this user
      try {
        await mappingStore.set(iamUserId, {
          iamUserId,
          username: iamUser.username,
          activationStatus: activationStatus || 'PASSWORD_SETUP_REQUIRED',
          updatedAt: Date.now()
        });
        console.log(`[LOGIN] User mapping updated: ${iamUserId} ${getLineNum()}`);
      } catch (mapErr) {
        console.warn(`[LOGIN] Failed to update mapping ${getLineNum()}:`, mapErr.message);
      }

      // Generate OTP
      let txnId, otpResp;
      try {
        const sendResp = await sendOtp(identifier);

        txnId = sendResp.data.result.txnId;
        otpResp = sendResp.data.result;

        console.log(`[LOGIN] OTP sent, txnId: ${txnId} ${getLineNum()}`);
      } catch (otpErr) {
        console.error(`[LOGIN] Failed to send OTP ${getLineNum()}:`, otpErr.response?.data || otpErr.message);
        return res.status(500).json({ error: 'Failed to send OTP' });
      }

      // Store transaction data in Redis
      await txnStore.set(txnId, {
        identifier,
        username: iamUser.username,
        iamUserId,
        txnId,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      console.log(`[LOGIN] Transaction stored: ${txnId} ${getLineNum()}`);

      return res.json({
        flow: 'OTP_VERIFICATION',
        txnId,
        otpResponse: otpResp
      });
    }

    return res.status(400).json({ error: 'Unable to determine user status' });

  } catch (err) {
    console.error(`[LOGIN] Error ${getLineNum()}:`, err.response?.data || err.message);
    if (err.response?.status === 404) return res.status(404).json({ error: 'User not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
