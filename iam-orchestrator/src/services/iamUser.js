import axios from 'axios';
import { IAM_SERVICE_URL } from '../config/index.js';
import { getLineNum, isEmail, maskIdentifier } from '../utils/helpers.js';

/**
 * Resolve canonical user from User Service by identifier (email, phone, or username).
 * Returns canonical user identity.
 */
export async function resolveCanonicalUser(identifier) {
  console.log(`[IAM] Resolving canonical user for ${maskIdentifier(identifier)} ${getLineNum()}`);

  let query;
  if (isEmail(identifier)) {
    query = `email=${encodeURIComponent(identifier)}&isEncrypted=false`;
  } else if (/^\d{10}$/.test(identifier)) {
    // Phone: 10 digits
    query = `phone=${encodeURIComponent(identifier)}&isEncrypted=false`;
  } else {
    // Username
    query = `username=${encodeURIComponent(identifier)}&isEncrypted=false`;
  }

  try {
    const resp = await axios.get(`${IAM_SERVICE_URL}/users?${query}`, { timeout: 15000 });
    const user = resp.data?.user || resp.data;

    if (!user || !user.id) {
      console.warn(`[IAM] No user found for ${maskIdentifier(identifier)} ${getLineNum()}`);
      return null;
    }

    const canonicalUser = {
      userId: user.id || user.userid,
      username: user.username,
      firstName: user.firstname || user.firstName,
      lastName: user.lastname || user.lastName,
      email: user.email,
      phone: user.phone || user.mobile,
      status: user.status
    };

    console.log(`[IAM] Resolved canonical user: userId=${canonicalUser.userId}, username=${canonicalUser.username} ${getLineNum()}`);
    return canonicalUser;
  } catch (err) {
    console.error(`[IAM] Error resolving canonical user ${getLineNum()}:`, err.response?.data || err.message);
    throw err;
  }
}
