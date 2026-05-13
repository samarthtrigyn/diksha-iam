import { Router } from 'express';
import {
  KEYCLOAK_PUBLIC_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, SESSION_TTL, SESSION_COOKIE_NAME
} from '../../config/index.js';
import { getLineNum } from '../../utils/helpers.js';
import { validateTokenClaims } from '../../utils/token.js';
import { refreshToken as refreshTokenWithKeycloak } from '../../services/keycloak.js';
import { getSession, rotateSession } from '../../services/session.js';
import { setSecureCookie, getSessionIdFromCookie } from '../../middleware/secureCookie.js';

const router = Router();

/**
 * POST /iam/auth/refresh
 * 
 * Refresh access token using refresh token
 * Refresh token can be provided via:
 *   1. Secure HttpOnly cookie (preferred)
 *   2. Request body refreshToken field
 * 
 * Request:
 *   - refreshToken (optional): Explicit refresh token (if not using cookie)
 * 
 * Response (Success):
 *   - accessToken: New access token
 *   - expiresIn: Token expiry in seconds
 * 
 * Response (Error):
 *   - error, errorDescription, statusCode
 */
router.post('/iam/auth/refresh', async (req, res) => {
  try {
    // ── STEP 1: Get session from cookie or explicit refresh token ──
    const sessionId = getSessionIdFromCookie(req, SESSION_COOKIE_NAME);
    const explicitRefreshToken = req.body?.refreshToken;

    if (!sessionId && !explicitRefreshToken) {
      console.warn(`[AUTH-REFRESH] No session or refresh token provided ${getLineNum()}`);
      return res.status(401).json({
        error: 'unauthorized',
        errorDescription: 'No session or refresh token provided',
        statusCode: 401
      });
    }

    let session;
    let refreshToken;

    if (sessionId) {
      // ── STEP 2A: Retrieve session from Redis ──
      session = await getSession(sessionId);
      if (!session) {
        console.warn(`[AUTH-REFRESH] Session not found: ${sessionId} ${getLineNum()}`);
        return res.status(401).json({
          error: 'unauthorized',
          errorDescription: 'Session expired or invalid',
          statusCode: 401
        });
      }
      refreshToken = session.refreshToken;
      console.log(`[AUTH-REFRESH] Session retrieved: ${sessionId} ${getLineNum()}`);
    } else {
      // ── STEP 2B: Use explicit refresh token ──
      refreshToken = explicitRefreshToken;
      console.log(`[AUTH-REFRESH] Using explicit refresh token ${getLineNum()}`);
    }

    // ── STEP 3: Exchange refresh token for new access token ──
    let tokenResp;
    try {
      tokenResp = await refreshTokenWithKeycloak(refreshToken, KEYCLOAK_CLIENT_ID);
      console.log(`[AUTH-REFRESH] Token refresh successful ${getLineNum()}`);
    } catch (refreshErr) {
      const statusCode = refreshErr.statusCode || 401;
      const error = refreshErr.error || 'invalid_grant';
      const errorDescription = refreshErr.errorDescription || 'Token refresh failed';
      console.warn(`[AUTH-REFRESH] Token refresh failed ${getLineNum()}:`, errorDescription);

      // If session-based refresh fails, clear the session
      if (sessionId) {
        await rotateSession(sessionId, { accessToken: null }, SESSION_TTL);
      }

      return res.status(statusCode).json({
        error,
        errorDescription,
        statusCode
      });
    }

    // ── STEP 4: Validate new access token ──
    const expectedIssuer = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`;
    try {
      validateTokenClaims(
        tokenResp.access_token,
        null,
        expectedIssuer,
        null
      );
      console.log(`[AUTH-REFRESH] Access token validated ${getLineNum()}`);
    } catch (validateErr) {
      console.error(`[AUTH-REFRESH] Token validation failed ${getLineNum()}:`, validateErr.message);
      return res.status(401).json({
        error: 'invalid_token',
        errorDescription: `Token validation failed: ${validateErr.message}`,
        statusCode: 401
      });
    }

    // ── STEP 5: Rotate session with new tokens (if session-based) ──
    if (sessionId && session) {
      try {
        await rotateSession(sessionId, {
          accessToken: tokenResp.access_token,
          idToken: tokenResp.id_token,
          refreshToken: tokenResp.refresh_token || refreshToken,
          expiresIn: tokenResp.expires_in,
          tokenType: 'Bearer'
        }, SESSION_TTL);

        // Update cookie TTL
        setSecureCookie(res, SESSION_COOKIE_NAME, sessionId, {
          maxAge: SESSION_TTL * 1000,
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          sameSite: 'Strict'
        });

        console.log(`[AUTH-REFRESH] Session rotated: ${sessionId} ${getLineNum()}`);
      } catch (sessErr) {
        console.error(`[AUTH-REFRESH] Failed to rotate session ${getLineNum()}:`, sessErr.message);
        return res.status(500).json({
          error: 'server_error',
          errorDescription: 'Failed to update session',
          statusCode: 500
        });
      }
    }

    console.log(`[AUTH-REFRESH] Token refresh completed ${getLineNum()}`);

    return res.json({
      accessToken: tokenResp.access_token,
      idToken: tokenResp.id_token,
      refreshToken: tokenResp.refresh_token || refreshToken,
      expiresIn: tokenResp.expires_in,
      tokenType: 'Bearer'
    });

  } catch (err) {
    console.error(`[AUTH-REFRESH] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
