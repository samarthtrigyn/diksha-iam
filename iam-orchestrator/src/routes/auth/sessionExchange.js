import { Router } from 'express';
import { getLineNum } from '../../utils/helpers.js';
import sessionCodeStore from '../../stores/sessionCodeStore.js';
import sessionStore from '../../stores/sessionStore.js';
import { validateSessionExchange } from '../../middleware/validation.js';

const router = Router();

/**
 * POST /iam/auth/session/exchange
 *
 * Mobile/third-party clients exchange a temporary sessionCode for access/refresh tokens.
 * Requires: clientId match, sessionCode not yet used, sessionCode not expired.
 * After exchange, sessionCode is marked as used (single-use).
 *
 * Request:
 *   {
 *     "clientId": "diksha-mobile",
 *     "sessionCode": "hex-string-from-callback"
 *   }
 *
 * Response (Success):
 *   {
 *     "accessToken": "...",
 *     "refreshToken": "...",
 *     "tokenType": "Bearer",
 *     "expiresIn": 1800,
 *     "user": {
 *       "userId": "...",
 *       "username": "...",
 *       "roles": [...]
 *     }
 *   }
 *
 * Response (Error):
 *   {
 *     "error": "...",
 *     "errorDescription": "...",
 *     "statusCode": 400/404/500
 *   }
 */
router.post('/iam/auth/session/exchange', validateSessionExchange, async (req, res) => {
  try {
    const { clientId, sessionCode } = req.body;

    console.log(
      `[SESSION-EXCHANGE] clientId: ${clientId}, sessionCode: ${sessionCode.substring(0, 8)}... ${getLineNum()}`
    );

    // ── STEP 1: Load and validate sessionCode ──
    const sessionCodeData = await sessionCodeStore.get(sessionCode);
    if (!sessionCodeData) {
      console.warn(
        `[SESSION-EXCHANGE] SessionCode not found or expired: ${sessionCode.substring(0, 8)}... ${getLineNum()}`
      );
      return res.status(404).json({
        error: 'session_code_invalid',
        errorDescription: 'Session code not found or expired',
        statusCode: 404,
        timestamp: new Date().toISOString()
      });
    }

    // Check if already used
    if (sessionCodeData.used) {
      console.warn(
        `[SESSION-EXCHANGE] SessionCode already used: ${sessionCode.substring(0, 8)}... ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'session_code_used',
        errorDescription: 'Session code has already been exchanged',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    // Check if expired
    if (Date.now() > sessionCodeData.expiresAt) {
      console.warn(
        `[SESSION-EXCHANGE] SessionCode expired: ${sessionCode.substring(0, 8)}... ${getLineNum()}`
      );
      await sessionCodeStore.delete(sessionCode);
      return res.status(400).json({
        error: 'session_code_expired',
        errorDescription: 'Session code has expired',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    const { sessionId, iamUserId, username, clientId: codeClientId } = sessionCodeData;

    // ── STEP 2: Validate clientId matches ──
    if (clientId !== codeClientId) {
      console.warn(
        `[SESSION-EXCHANGE] ClientId mismatch: provided=${clientId}, expected=${codeClientId} ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'invalid_client',
        errorDescription: 'Client ID does not match session code',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    console.log(
      `[SESSION-EXCHANGE] SessionCode validated for client=${clientId}, user=${iamUserId} ${getLineNum()}`
    );

    // ── STEP 3: Load session ──
    const session = await sessionStore.get(sessionId);
    if (!session) {
      console.error(
        `[SESSION-EXCHANGE] Session not found: ${sessionId} ${getLineNum()}`
      );
      return res.status(500).json({
        error: 'session_not_found',
        errorDescription: 'Referenced session not found',
        statusCode: 500,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[SESSION-EXCHANGE] Session loaded: ${sessionId} ${getLineNum()}`);

    // ── STEP 4: Mark sessionCode as used ──
    const marked = await sessionCodeStore.markUsed(sessionCode);
    if (!marked) {
      console.warn(
        `[SESSION-EXCHANGE] Failed to mark sessionCode as used: ${sessionCode.substring(0, 8)}... ${getLineNum()}`
      );
      return res.status(400).json({
        error: 'session_code_already_used',
        errorDescription: 'Session code has already been exchanged',
        statusCode: 400,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[SESSION-EXCHANGE] SessionCode marked as used ${getLineNum()}`);

    // ── STEP 5: Return tokens and user profile ──
    return res.status(200).json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn || 1800,
      user: {
        userId: iamUserId,
        username,
        roles: [] // Would be enriched from token claims if available
      }
    });

  } catch (err) {
    console.error(`[SESSION-EXCHANGE] Unexpected error ${getLineNum()}:`, err.message);
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
