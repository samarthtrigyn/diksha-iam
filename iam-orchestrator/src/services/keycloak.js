import axios from 'axios';
import {
  KEYCLOAK_URL, KEYCLOAK_REALM,
  KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET
} from '../config/index.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Log Keycloak request/response for debugging
 */
export const logKeycloakCall = (method, endpoint, statusCode, data = null, error = null) => {
  const timestamp = new Date().toISOString();
  const status = error ? 'ERROR' : 'SUCCESS';
  const ln = getLineNum();
  console.log(`[KEYCLOAK-${status}] ${timestamp} ${method} ${endpoint} → ${statusCode} ${ln}`);
  if (data) {
    const summary = typeof data === 'string' ? data : JSON.stringify(data).substring(0, 150);
    console.log(`  └─ ${summary}`);
  }
  if (error) {
    console.error(`  └─ Error: ${error.message || error}`);
  }
};

/**
 * Get a short-lived Keycloak admin token via service-account client_credentials.
 * Avoids hardcoding admin username/password in application code (requirement G).
 */
export async function getAdminToken() {
  const endpoint = `/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  try {
    console.log(`[KEYCLOAK-REQ] POST ${endpoint} (grant_type: client_credentials) ${getLineNum()}`);

    const resp = await axios.post(
      `${KEYCLOAK_URL}${endpoint}`,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     KC_ADMIN_CLIENT_ID,
        client_secret: KC_ADMIN_CLIENT_SECRET
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
        validateStatus: (s) => s < 500
      }
    );

    logKeycloakCall('POST', endpoint, resp.status, `access_token: ${resp.data.access_token ? 'granted' : 'null'}`);

    if (resp.status !== 200 || !resp.data.access_token) {
      throw new Error(
        `Failed to obtain service-account token: ${resp.status} ${JSON.stringify(resp.data)}`
      );
    }
    return resp.data.access_token;
  } catch (err) {
    logKeycloakCall('POST', endpoint, err.response?.status || 'TIMEOUT', null, err);
    throw err;
  }
}

/**
 * Create or idempotently update a Keycloak user from canonical IAM user.
 * Uses User Service username as Keycloak username.
 * Stores iamUserId and sunbirdUserId in attributes.
 * Returns the Keycloak user ID.
 */
export async function upsertKeycloakUserFromIamUser(iamUser, adminToken) {
  const { userId, username, firstName, lastName, email, phone } = iamUser;

  const createEndpoint = `/admin/realms/${KEYCLOAK_REALM}/users`;

  try {
    // Step 1: Search for existing user by canonical username
    console.log(`[KEYCLOAK-REQ] GET ${createEndpoint}?username=${username}&exact=true ${getLineNum()}`);

    const searchResp = await axios.get(
      `${KEYCLOAK_URL}${createEndpoint}?username=${encodeURIComponent(username)}&exact=true`,
      {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        timeout: 10000,
        validateStatus: () => true
      }
    );

    logKeycloakCall('GET', `${createEndpoint}?username=...`, searchResp.status, `Found ${searchResp.data?.length || 0} user(s)`);

    if (searchResp.status === 200 && searchResp.data?.length > 0) {
      // User exists – update attributes and requiredActions
      const existing = searchResp.data[0];
      const kcUserId = existing.id;

      console.log(`[KEYCLOAK] User exists: ${username} (${kcUserId}), updating attributes ${getLineNum()}`);

      // Ensure UPDATE_PASSWORD action, remove VERIFY_PROFILE and UPDATE_PROFILE (we populate names from user service)
      const actions = Array.from(
        new Set([
          ...(existing.requiredActions || []).filter(a => a !== 'VERIFY_PROFILE' && a !== 'UPDATE_PROFILE'),
          'UPDATE_PASSWORD'
        ])
      );

      const updatePayload = {
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        email: email || existing.email || '',  // Always include email from IAM (trust as source of truth)
        enabled: true,
        emailVerified: true,  // Trust IAM as source of truth
        requiredActions: actions,
        attributes: {
          iamUserId: [userId],
          sunbirdUserId: [userId],
          ...(phone && { phone: [phone] })
        }
      };

      console.log(`[KEYCLOAK-REQ] PUT ${createEndpoint}/${kcUserId} (update attributes) ${getLineNum()}`);

      const updateResp = await axios.put(
        `${KEYCLOAK_URL}${createEndpoint}/${kcUserId}`,
        updatePayload,
        {
          headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      logKeycloakCall('PUT', `${createEndpoint}/${kcUserId}`, updateResp.status, `User updated with actions: ${actions.join(', ')}`);

      return userId;  // iamUserId === keycloakUserId
    }

    // Step 2: User doesn't exist – create new
    console.log(`[KEYCLOAK-REQ] POST ${createEndpoint} (username: ${username}) ${getLineNum()}`);

    const userPayload = {
      id: userId,
      username,
      enabled: true,
      firstName,
      lastName,
      email: email || '',  // Always include email from IAM (even if empty)
      emailVerified: true,  // Trust IAM as source of truth
      requiredActions: ['UPDATE_PASSWORD'],
      attributes: {
        iamUserId: [userId],
        sunbirdUserId: [userId],
        ...(phone && { phone: [phone] })
      }
    };

    const createResp = await axios.post(
      `${KEYCLOAK_URL}${createEndpoint}`,
      userPayload,
      {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: (s) => s < 500
      }
    );

    logKeycloakCall('POST', createEndpoint, createResp.status, `User creation attempt for ${username}`);

    if (createResp.status === 201) {
      console.log(`[KEYCLOAK] User created: ${username} (${userId}) with iamUserId=${userId} ${getLineNum()}`);
      return userId;  // iamUserId === keycloakUserId (we set id: userId in payload)
    }

    logKeycloakCall('POST', createEndpoint, createResp.status, `Unexpected response: ${JSON.stringify(createResp.data)}`);
    throw new Error(
      `Unexpected status ${createResp.status} creating Keycloak user: ${JSON.stringify(createResp.data)}`
    );
  } catch (err) {
    logKeycloakCall('POST/PUT', createEndpoint, err.response?.status || 'ERROR', null, err);
    throw err;
  }
}
