import { Router } from 'express';
import axios from 'axios';
import { KEYCLOAK_URL, KEYCLOAK_REALM, SESSION_COOKIE_NAME } from '../config/index.js';
import { getLineNum, maskIdentifier } from '../utils/helpers.js';
import { logKeycloakCall, revokeToken } from '../services/keycloak.js';
import { deleteSession } from '../services/session.js';
import { clearSecureCookie, getSessionIdFromCookie } from '../middleware/secureCookie.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// POST /iam/auth/logout  (spec-compliant path)
// POST /iam/logout        (legacy path)
//
// Revokes tokens with Keycloak and clears user session.
// Supports logoutAllDevices flag to revoke all active sessions for user (best-effort).
// ──────────────────────────────────────────────────────────────────────────────
async function handleLogout(req, res) {
  try {
    const { clientId, refreshToken, logoutAllDevices } = req.body;
    const sessionId = getSessionIdFromCookie(req, SESSION_COOKIE_NAME);

    console.log(
      `[LOGOUT] clientId: ${clientId || 'not provided'}, sessionId: ${sessionId ? sessionId.substring(0, 8) : 'none'}, logoutAllDevices: ${logoutAllDevices || false} ${getLineNum()}`
    );

    // ── STEP 1: Revoke refresh token with Keycloak ──
    if (refreshToken) {
      try {
        await revokeToken(refreshToken, "KEYCLOAK_CLIENT_ID");
        console.log(`[LOGOUT] Refresh token revoked ${getLineNum()}`);
      } catch (err) {
        console.warn(`[LOGOUT] Failed to revoke refresh token ${getLineNum()}:`, err.message);
        // Continue logout even if token revocation fails
      }
    }

    // ── STEP 2: Delete current application session ──
    if (sessionId) {
      try {
        await deleteSession(sessionId);
        console.log(`[LOGOUT] Session deleted: ${sessionId.substring(0, 8)}... ${getLineNum()}`);
      } catch (sessErr) {
        console.warn(`[LOGOUT] Failed to delete session ${getLineNum()}:`, sessErr.message);
        // Continue logout even if session deletion fails
      }
    }

    // ── STEP 3: Handle logoutAllDevices (best-effort) ──
    if (logoutAllDevices) {
      console.log(`[LOGOUT] logoutAllDevices requested ${getLineNum()}`);
      // NOTE: Keycloak does not provide a direct API to enumerate and revoke all sessions
      // for a user. A full implementation would require:
      // 1. Maintaining a user → [sessionIds] index in Redis
      // 2. Revoking Keycloak sessions via admin API
      // For now, we log the request but only revoke the current session.
      // Future enhancement: implement user session index.
      console.log(
        `[LOGOUT] logoutAllDevices: Partial support (current session only). Full impl requires user session index. ${getLineNum()}`
      );
    }

    // ── STEP 4: Clear secure cookie ──
    clearSecureCookie(res, SESSION_COOKIE_NAME);

    // ── STEP 5: Note about mapping preservation ──
    // We intentionally do NOT delete the mapping. The mapping stores long-term
    // activationStatus (ACTIVE, etc.) and must persist across sessions so the
    // next login doesn't restart the OTP flow.
    console.log(`[LOGOUT] Logout successful ${getLineNum()}`);

    return res.status(200).json({
      status: 'LOGGED_OUT',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(`[LOGOUT] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Logout failed',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
}

router.post('/iam/auth/logout', handleLogout);
router.post('/iam/logout', handleLogout);

export default router;
