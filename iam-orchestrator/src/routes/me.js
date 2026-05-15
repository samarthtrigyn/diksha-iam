import { Router } from 'express';
import { KEYCLOAK_CLIENT_ID, SESSION_COOKIE_NAME } from '../config/index.js';
import { getLineNum } from '../utils/helpers.js';
import { getSession } from '../services/session.js';
import { getSessionIdFromCookie } from '../middleware/secureCookie.js';
import { validateTokenClaims } from '../utils/token.js';
import mappingStore from '../stores/mappingStore.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/users/me  (spec-compliant path)
// GET /iam/me         (legacy path)
// Returns authenticated user profile and session details
// Supports:
//   1. Session cookie (preferred): Reads from sessionId in secure cookie
//   2. Bearer token: Reads from Authorization header
// ──────────────────────────────────────────────────────────────────────────────
async function handleMe(req, res) {
  try {
    let userInfo = null;
    let activationStatus = 'ACTIVE';
    let loginProvider = 'KEYCLOAK';
    let org = { orgId: null, orgName: null };

    // ── STEP 1: Try to get session from secure cookie ──
    const sessionId = getSessionIdFromCookie(req, SESSION_COOKIE_NAME);
    if (sessionId) {
      console.log(`[ME] Session cookie found: ${sessionId.substring(0, 8)}... ${getLineNum()}`);

      const session = await getSession(sessionId);
      if (session) {
        console.log(`[ME] Session retrieved for user: ${session.iamUserId} ${getLineNum()}`);

        userInfo = {
          userId: session.iamUserId,
          username: session.username,
          email: '',
          name: '',
          roles: [],
          loginProvider,
          org,
          source: 'session'
        };

        // Get activation status from mapping
        try {
          const mapping = await mappingStore.get(session.iamUserId);
          if (mapping) {
            activationStatus = mapping.activationStatus || 'ACTIVE';
          }
        } catch (mapErr) {
          console.warn(`[ME] Failed to retrieve mapping ${getLineNum()}:`, mapErr.message);
        }

        console.log(
          `[ME] Returning user info from session for ${session.username}, status: ${activationStatus} ${getLineNum()}`
        );

        return res.status(200).json({
          ...userInfo,
          status: activationStatus,
          timestamp: new Date().toISOString()
        });
      }
    }

    // ── STEP 2: Fallback to Bearer token ──
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        errorDescription: 'Missing session or Authorization header',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.slice(7);
    let payload;
    try {
      payload = validateTokenClaims(token, null, null, null);
      console.log(
        `[ME] Bearer token validated, sub: ${payload.sub}, username: ${payload.preferred_username} ${getLineNum()}`
      );
    } catch (validateErr) {
      console.warn(
        `[ME] Bearer token validation failed ${getLineNum()}:`,
        validateErr.message
      );
      return res.status(401).json({
        error: 'unauthorized',
        errorDescription: 'Invalid or expired token',
        statusCode: 401,
        timestamp: new Date().toISOString()
      });
    }

    // Extract user information from token
    const iamUserId = payload.iamUserId || payload.iam_user_id || payload.sunbirdUserId || payload.sunbird_user_id;

    userInfo = {
      userId: iamUserId,
      username: payload.preferred_username,
      email: payload.email || '',
      name: payload.name || '',
      roles: payload.realm_access?.roles || [],
      loginProvider,
      org,
      source: 'bearer_token'
    };

    // Get activation status from mapping if available
    if (iamUserId) {
      try {
        const mapping = await mappingStore.get(iamUserId);
        if (mapping) {
          activationStatus = mapping.activationStatus || 'ACTIVE';
          console.log(
            `[ME] Retrieved activation status from mapping: ${activationStatus} ${getLineNum()}`
          );
        }
      } catch (mapErr) {
        console.warn(`[ME] Failed to retrieve mapping ${getLineNum()}:`, mapErr.message);
      }
    }

    console.log(
      `[ME] Returning user info from token for ${payload.preferred_username}, iamUserId: ${iamUserId}, status: ${activationStatus} ${getLineNum()}`
    );

    return res.status(200).json({
      ...userInfo,
      status: activationStatus,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(`[ME] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
}

router.get('/iam/users/me', handleMe);
router.get('/iam/me', handleMe);

export default router;
