import { Router } from 'express';
import { getLineNum, maskIdentifier } from '../../utils/helpers.js';
import { resolveCanonicalUser } from '../../services/iamUser.js';
import mappingStore from '../../stores/mappingStore.js';
import { validateUsersResolve } from '../../middleware/validation.js';

const router = Router();

/**
 * POST /iam/users/resolve
 *
 * Resolve a login identifier (email/mobile/username/SSO subject) to the canonical
 * internal userId and return key user metadata.
 *
 * Request:
 *   - identifier (required): email, phone, username
 *
 * Response:
 *   - iamUserId: Internal user ID
 *   - username: Canonical username
 *   - email
 *   - phone
 *   - activationStatus: ACTIVE | PASSWORD_SETUP_REQUIRED | etc.
 */
router.post('/iam/users/resolve', validateUsersResolve, async (req, res) => {
  try {
    const { identifier } = req.body;
    console.log(`[USERS-RESOLVE] Resolving identifier: ${maskIdentifier(identifier)} ${getLineNum()}`);

    // ── STEP 1: Resolve canonical user from User Service ──
    const iamUser = await resolveCanonicalUser(identifier);
    if (!iamUser) {
      return res.status(404).json({
        error: 'user_not_found',
        errorDescription: 'No user found for the provided identifier',
        statusCode: 404
      });
    }

    const iamUserId = iamUser.userId || iamUser.id;
    console.log(`[USERS-RESOLVE] Resolved user: ${iamUserId} ${getLineNum()}`);

    // ── STEP 2: Enrich with activation status from mapping ──
    let activationStatus = null;
    try {
      const mapping = await mappingStore.get(iamUserId);
      activationStatus = mapping?.activationStatus || null;
    } catch (mapErr) {
      console.warn(`[USERS-RESOLVE] Mapping lookup failed ${getLineNum()}:`, mapErr.message);
    }

    return res.json({
      iamUserId,
      username: iamUser.username,
      email: iamUser.email,
      phone: iamUser.phone,
      firstName: iamUser.firstName,
      lastName: iamUser.lastName,
      activationStatus,
      status: iamUser.status
    });

  } catch (err) {
    console.error(`[USERS-RESOLVE] Error ${getLineNum()}:`, err.response?.data || err.message);
    if (err.response?.status === 404) {
      return res.status(404).json({
        error: 'user_not_found',
        errorDescription: 'User not found',
        statusCode: 404
      });
    }
    return res.status(500).json({
      error: 'server_error',
      errorDescription: 'Internal server error',
      statusCode: 500
    });
  }
});

export default router;
