import { Router } from 'express';
import { KEYCLOAK_CLIENT_ID } from '../config/index.js';
import { getLineNum } from '../utils/helpers.js';
import mappingStore from '../stores/mappingStore.js';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// GET /iam/me
// ──────────────────────────────────────────────────────────────────────────────
router.get('/iam/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(401).json({ error: 'Invalid token format' });

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch {
      return res.status(401).json({ error: 'Malformed token payload' });
    }

    console.log(`[ME] Token decoded, sub: ${payload.sub}, username: ${payload.preferred_username} ${getLineNum()}`);

    // ── STEP 1: Prefer iam_user_id or sunbird_user_id from claims (set by Keycloak mapper) ──
    let iamUserId = payload.iamUserId || payload.iam_user_id || payload.sunbirdUserId || payload.sunbird_user_id;
    let activationStatus = 'ACTIVE';

    // ── STEP 2: Resolve user information ──
    let userInfo = {
      id: payload.sub,
      email: payload.email,
      username: payload.preferred_username,
      name: payload.name,
      iamUserId,
      roles: payload.realm_access?.roles || [],
      clientRoles: payload.resource_access?.[KEYCLOAK_CLIENT_ID]?.roles || []
    };

    // ── STEP 3: Get activation status from mapping if available ──
    if (iamUserId) {
      try {
        const mapping = await mappingStore.get(iamUserId);
        if (mapping) {
          activationStatus = mapping.activationStatus || 'ACTIVE';
          console.log(`[ME] Retrieved activation status from mapping: ${activationStatus} ${getLineNum()}`);
        }
      } catch (mapErr) {
        console.warn(`[ME] Failed to retrieve mapping ${getLineNum()}:`, mapErr.message);
      }
    }

    console.log(`[ME] Returning user info for ${payload.preferred_username}, iamUserId: ${iamUserId}, status: ${activationStatus} ${getLineNum()}`);

    return res.json({
      ...userInfo,
      activationStatus,
      keycloakClaims: payload
    });

  } catch (err) {
    console.error(`[ME] Error ${getLineNum()}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
