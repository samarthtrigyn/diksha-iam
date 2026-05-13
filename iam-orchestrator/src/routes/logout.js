import { Router } from 'express';
import axios from 'axios';
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, SESSION_COOKIE_NAME } from '../config/index.js';
import { getLineNum, maskIdentifier } from '../utils/helpers.js';
import { logKeycloakCall, revokeToken } from '../services/keycloak.js';
import { deleteSession } from '../services/session.js';
import { clearSecureCookie, getSessionIdFromCookie } from '../middleware/secureCookie.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/logout
// Revokes tokens with Keycloak and clears user session
// ──────────────────────────────────────────────────────────────────────────────
router.post('/iam/logout', async (req, res) => {
  try {
    const { refreshToken, iamUserId } = req.body;
    const sessionId = getSessionIdFromCookie(req, SESSION_COOKIE_NAME);

    console.log(`[LOGOUT] /iam/logout – iamUserId: ${iamUserId ? maskIdentifier(iamUserId) : 'unknown'}, sessionId: ${sessionId ? sessionId.substring(0, 8) : 'none'} ${getLineNum()}`);

    // ── STEP 1: Revoke refresh token with Keycloak ──
    if (refreshToken) {
      try {
        await revokeToken(refreshToken, KEYCLOAK_CLIENT_ID);
        console.log(`[LOGOUT] Token revoked ${getLineNum()}`);
      } catch (err) {
        console.warn(`[LOGOUT] Failed to revoke token ${getLineNum()}:`, err.message);
        // Continue logout even if token revocation fails
      }
    }

    // ── STEP 2: Delete application session from Redis ──
    if (sessionId) {
      try {
        await deleteSession(sessionId);
        console.log(`[LOGOUT] Session deleted: ${sessionId.substring(0, 8)}... ${getLineNum()}`);
      } catch (sessErr) {
        console.warn(`[LOGOUT] Failed to delete session ${getLineNum()}:`, sessErr.message);
        // Continue logout even if session deletion fails
      }
    }

    // ── STEP 3: Clear secure cookie ──
    clearSecureCookie(res, SESSION_COOKIE_NAME);

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
