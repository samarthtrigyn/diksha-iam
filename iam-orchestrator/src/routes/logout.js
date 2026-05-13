import { Router } from 'express';
import axios from 'axios';
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } from '../config/index.js';
import { getLineNum, maskIdentifier } from '../utils/helpers.js';
import { logKeycloakCall } from '../services/keycloak.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/logout
// Revokes tokens with Keycloak and clears user session
// ──────────────────────────────────────────────────────────────────────────────
router.post('/iam/logout', async (req, res) => {
  try {
    const { refreshToken, iamUserId } = req.body;

    console.log(`[LOGOUT] /iam/logout – iamUserId: ${iamUserId ? maskIdentifier(iamUserId) : 'unknown'} ${getLineNum()}`);

    // ── STEP 1: Revoke refresh token with Keycloak ──
    if (refreshToken) {
      const revokeEndpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/revoke`;
      try {
        console.log(`[KEYCLOAK-REQ] POST ${revokeEndpoint} (revoke token) ${getLineNum()}`);

        const revokeResp = await axios.post(
          `${KEYCLOAK_URL}${revokeEndpoint}`,
          new URLSearchParams({
            client_id: KEYCLOAK_CLIENT_ID,
            token: refreshToken,
            token_type_hint: 'refresh_token'
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            validateStatus: (s) => s < 500
          }
        );

        logKeycloakCall('POST', revokeEndpoint, revokeResp.status, 'Token revocation attempt');

        if (revokeResp.status !== 200 && revokeResp.status !== 204) {
          console.warn(`[LOGOUT] Token revocation returned ${revokeResp.status} ${getLineNum()}`);
          // Continue logout even if token revocation fails
        }
      } catch (err) {
        console.warn(`[LOGOUT] Failed to revoke token ${getLineNum()}:`, err.message);
        // Continue logout even if token revocation fails
      }
    }

    // NOTE: We intentionally do NOT delete the mapping here.
    // The mapping stores the user's long-term activationStatus (ACTIVE, etc.)
    // and must persist across sessions so the next login uses Direct Grant
    // instead of restarting the OTP flow.
    if (iamUserId) {
      console.log(`[LOGOUT] Mapping preserved for ${maskIdentifier(iamUserId)} (activationStatus retained) ${getLineNum()}`);
    }

    console.log(`[LOGOUT] Logout successful ${getLineNum()}`);
    return res.json({
      status: 'logged_out',
      message: 'User logged out successfully'
    });

  } catch (err) {
    console.error(`[LOGOUT] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
