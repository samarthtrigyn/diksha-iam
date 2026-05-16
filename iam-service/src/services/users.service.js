const crypto = require('crypto');
const { execute } = require('../db/cassandra');
const { decryptStoredField, encryptLookupValue, encryptStoredField } = require('../utils/crypto');
const { HttpError } = require('./sso.service');

const LOOKUP_USER_QUERY = `
  SELECT userid
  FROM user_lookup
  WHERE type = ? AND value = ?
`;

const USER_BY_ID_QUERY = `
  SELECT *
  FROM user
  WHERE id = ?
`;

const USERNAME_CANDIDATES_PER_ITERATION = 10;
const USERNAME_MAX_ITERATIONS = 10;

function nowUtcString() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '+0000');
}

function toCanonicalId(inputId) {
  if (inputId && typeof inputId === 'string') {
    return inputId.trim();
  }
  return crypto.randomUUID();
}

function normalizeForLookup(value) {
  return String(value).trim().toLowerCase();
}

function normalizeForStorage(value, field) {
  if (value == null) return value;
  const stringValue = String(value).trim();
  if (field === 'email' || field === 'username') {
    return stringValue.toLowerCase();
  }
  return stringValue;
}

function parseBooleanQueryFlag(value, flagName) {
  if (value == null || value === '') return true;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new HttpError(400, `${flagName} must be either true or false.`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function validatePhone(value) {
  return /^\d{10}$/.test(String(value).trim());
}

function validateDob(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function getUsernameSuffixLength() {
  const configured =
    process.env.sunbird_username_num_digits ?? process.env.SUNBIRD_USERNAME_NUM_DIGITS ?? '4';
  const parsed = Number.parseInt(String(configured).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
}

function slugifyName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function normalizeUsernameBase(firstname, lastname) {
  const fullName = `${firstname ?? ''} ${lastname ?? ''}`.trim();
  const slug = slugifyName(fullName).replace(/-+/g, '');
  return slug;
}

function randomAlphaNumericLower(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

function generateUsernameCandidates(base, suffixLength) {
  const candidates = [];
  for (let i = 0; i < USERNAME_CANDIDATES_PER_ITERATION; i += 1) {
    candidates.push(`${base}_${randomAlphaNumericLower(suffixLength)}`);
  }
  return candidates;
}

function decryptRequestedUserFields(user) {
  const next = { ...user };
  if (next.email != null) {
    next.email = decryptStoredField(next.email, 'email');
  }
  if (next.phone != null) {
    next.phone = decryptStoredField(next.phone, 'phone');
  }
  if (next.username != null) {
    next.username = decryptStoredField(next.username, 'username');
  }
  return next;
}

function formatUserForResponse(user, isEncrypted) {
  if (isEncrypted) {
    return user;
  }
  return decryptRequestedUserFields(user);
}

function formatWriteResponseFields(fields, isEncrypted) {
  const response = { ...fields };
  if (isEncrypted) {
    return response;
  }
  if (response.email != null) {
    response.email = decryptStoredField(response.email, 'email');
  }
  if (response.username != null) {
    response.username = response.username;
  }
  return response;
}

function validateCreatePayload(payload) {
  const invalidCreatePayloadError = () => new HttpError(400, 'Invalid request payload.');

  if (!isNonEmptyString(payload.firstname)) {
    throw invalidCreatePayloadError();
  }
  if (!isNonEmptyString(payload.lastname)) {
    throw invalidCreatePayloadError();
  }
  if (!isNonEmptyString(payload.dob)) {
    throw invalidCreatePayloadError();
  }
  if (!validateDob(payload.dob)) {
    throw invalidCreatePayloadError();
  }
  if (!isNonEmptyString(payload.email) && !isNonEmptyString(payload.phone)) {
    throw invalidCreatePayloadError();
  }
  if (isNonEmptyString(payload.email) && !validateEmail(payload.email)) {
    throw invalidCreatePayloadError();
  }
  if (isNonEmptyString(payload.phone) && !validatePhone(payload.phone)) {
    throw invalidCreatePayloadError();
  }
}

function validateGetInputs({ id, email, phone, username }) {
  if (id != null) {
    if (!isNonEmptyString(id)) {
      throw new HttpError(400, 'id is required.');
    }
    return;
  }
  const providedFilters = [email, phone, username].filter(f => isNonEmptyString(f)).length;
  if (providedFilters !== 1) {
    throw new HttpError(422, 'Provide exactly one of email, phone, or username.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  if (isNonEmptyString(email) && !validateEmail(email)) {
    throw new HttpError(422, 'email format is invalid.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  if (isNonEmptyString(phone) && !validatePhone(phone)) {
    throw new HttpError(422, 'phone must be a 10 digit number.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
}

function validateDeleteId(id) {
  if (!isNonEmptyString(id)) {
    throw new HttpError(422, 'id is required.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
}

function validatePatchPayload(payload) {
  if (!payload || Object.keys(payload).length === 0) {
    throw new HttpError(422, 'At least one field is required for update.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'email') && isNonEmptyString(payload.email) && !validateEmail(payload.email)) {
    throw new HttpError(422, 'email format is invalid.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'phone') && isNonEmptyString(payload.phone) && !validatePhone(payload.phone)) {
    throw new HttpError(422, 'phone must be a 10 digit number.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'dob') && isNonEmptyString(payload.dob) && !validateDob(payload.dob)) {
    throw new HttpError(422, 'dob must be in YYYY-MM-DD format.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
}

function mapEncryptedUserFields(data) {
  const next = { ...data };
  ['email', 'phone', 'username'].forEach((field) => {
    if (next[field] != null) {
      const normalized = normalizeForStorage(next[field], field);
      next[field] = encryptStoredField(normalized);
    }
  });
  return next;
}

async function fetchUserById(id) {
  const result = await execute(USER_BY_ID_QUERY, [id]);
  return result.rows[0] ?? null;
}

async function lookupUserIdByTypeValue(type, value) {
  const encryptedLookupValue = encryptLookupValue(normalizeForLookup(value));
  const result = await execute(LOOKUP_USER_QUERY, [type, encryptedLookupValue]);
  return result.rows[0]?.userid ?? null;
}

async function ensureLookupIsUnique(type, value, currentUserId = null, options = {}) {
  if (value == null || value === '') return;
  const existingUserId = await lookupUserIdByTypeValue(type, value);
  if (!existingUserId) return;
  if (currentUserId && existingUserId === currentUserId) return;
  const statusCode = options.statusCode ?? 409;
  if (statusCode === 422) {
    throw new HttpError(422, 'Unprocessable Entity: Semantic errors, such as validation failures.', {
      errorCode: 422,
      error: 'Unprocessable Entity',
    });
  }
  throw new HttpError(409, 'User exist');
}

async function resolveUsernameForCreate(payload) {
  if (payload.username != null && String(payload.username).trim() !== '') {
    const providedUsername = normalizeForStorage(payload.username, 'username');
    await ensureLookupIsUnique('username', providedUsername);
    console.info(`[users] Username before encryption (create): ${providedUsername}`);
    return providedUsername;
  }

  const base = normalizeUsernameBase(payload.firstname, payload.lastname);
  if (!base) {
    throw new HttpError(400, 'firstname is required for username generation.');
  }

  const suffixLength = getUsernameSuffixLength();
  for (let i = 0; i < USERNAME_MAX_ITERATIONS; i += 1) {
    const candidates = generateUsernameCandidates(base, suffixLength);
    for (const candidate of candidates) {
      const existingUserId = await lookupUserIdByTypeValue('username', candidate);
      if (!existingUserId) {
        console.info(`[users] Username before encryption (create): ${candidate}`);
        return candidate;
      }
    }
  }

  throw new HttpError(500, 'Unable to generate unique username, please retry.');
}

async function upsertLookup(type, value, userId) {
  if (value == null || value === '') return null;
  const encryptedLookupValue = encryptLookupValue(normalizeForLookup(value));
  await execute(
    'INSERT INTO user_lookup (type, value, userid) VALUES (?, ?, ?)',
    [type, encryptedLookupValue, userId],
  );
  return encryptedLookupValue;
}

async function deleteLookup(type, encryptedValue) {
  if (!encryptedValue) return;
  await execute('DELETE FROM user_lookup WHERE type = ? AND value = ?', [type, encryptedValue]);
}

function buildInsertUserStatement(data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const query = `INSERT INTO user (${keys.join(', ')}) VALUES (${placeholders})`;
  const params = keys.map((key) => data[key]);
  return { query, params };
}

function buildUpdateUserStatement(id, data) {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new HttpError(400, 'No editable fields provided.');
  }
  const setClause = keys.map((key) => `${key} = ?`).join(', ');
  const query = `UPDATE user SET ${setClause} WHERE id = ?`;
  const params = keys.map((key) => data[key]);
  params.push(id);
  return { query, params };
}

function applyDobMirror(data) {
  const next = { ...data };
  if (next.dob != null && next.dateofbirth == null) {
    next.dateofbirth = next.dob;
  } else if (next.dateofbirth != null && next.dob == null) {
    next.dob = next.dateofbirth;
  }
  return next;
}

function rejectImmutableFields(data) {
  if (Object.prototype.hasOwnProperty.call(data, 'id') || Object.prototype.hasOwnProperty.call(data, 'userid')) {
    throw new HttpError(400, 'id and userid are immutable.');
  }
}

async function createUser(payload = {}) {
  console.info('[users] Create requested');
  validateCreatePayload(payload);
  const id = toCanonicalId(payload.id);
  const timestamp = nowUtcString();
  const resolvedUsername = await resolveUsernameForCreate(payload);

  await ensureLookupIsUnique('email', payload.email);
  await ensureLookupIsUnique('phone', payload.phone);

  const basePayload = {
    ...payload,
    id,
    userid: id,
    status: payload.status ?? 1,
    isdeleted: payload.isdeleted ?? false,
    createddate: payload.createddate ?? timestamp,
    updateddate: payload.updateddate ?? timestamp,
    createdby: payload.createdby ?? null,
    updatedby: payload.updatedby ?? id,
    username: resolvedUsername,
  };

  const mirrored = applyDobMirror(basePayload);
  const encrypted = mapEncryptedUserFields(mirrored);
  const { query, params } = buildInsertUserStatement(encrypted);
  await execute(query, params);

  await upsertLookup('email', payload.email, id);
  await upsertLookup('phone', payload.phone, id);
  await upsertLookup('username', resolvedUsername, id);

  return {
    userId: id,
    email: encrypted.email ?? null,
    username: resolvedUsername,
  };
}

async function getUser({ id, email, phone, username }) {
  console.info('[users] Get requested');
  validateGetInputs({ id, email, phone });
  let userId = id;
  if (!userId && email) {
    userId = await lookupUserIdByTypeValue('email', email);
  }
  if (!userId && phone) {
    userId = await lookupUserIdByTypeValue('phone', phone);
  }
  if (!userId && username) {
    userId = await lookupUserIdByTypeValue('username', username);
  }

  if (!userId) {
    throw new HttpError(404, 'User not found.');
  }

  const user = await fetchUserById(userId);
  if (!user || user.isdeleted === true) {
    throw new HttpError(404, 'User not found.');
  }
  return user;
}

async function updateUser(id, payload = {}) {
  console.info('[users] Update requested');
  validateDeleteId(id);
  validatePatchPayload(payload);
  rejectImmutableFields(payload);
  const existing = await fetchUserById(id);
  if (!existing || existing.isdeleted === true) {
    throw new HttpError(404, 'User not found.');
  }

  await ensureLookupIsUnique('email', payload.email, id, { statusCode: 422 });
  await ensureLookupIsUnique('phone', payload.phone, id, { statusCode: 422 });
  await ensureLookupIsUnique('username', payload.username, id, { statusCode: 422 });
  if (Object.prototype.hasOwnProperty.call(payload, 'username') && isNonEmptyString(payload.username)) {
    console.info(`[users] Username before encryption (update): ${normalizeForStorage(payload.username, 'username')}`);
  }

  const oldEmailEncrypted = existing.email;
  const oldPhoneEncrypted = existing.phone;
  const oldUsernameEncrypted = existing.username;

  const updatePayload = {
    ...payload,
    updateddate: nowUtcString(),
    updatedby: id,
  };

  const mirrored = applyDobMirror(updatePayload);
  const encrypted = mapEncryptedUserFields(mirrored);
  const { query, params } = buildUpdateUserStatement(id, encrypted);
  await execute(query, params);

  let newEmailEncrypted = null;
  let newPhoneEncrypted = null;
  let newUsernameEncrypted = null;
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    newEmailEncrypted = await upsertLookup('email', payload.email, id);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'phone')) {
    newPhoneEncrypted = await upsertLookup('phone', payload.phone, id);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'username')) {
    const normalizedUsername = normalizeForStorage(payload.username, 'username');
    newUsernameEncrypted = await upsertLookup('username', normalizedUsername, id);
  }

  if (newEmailEncrypted && oldEmailEncrypted && newEmailEncrypted !== oldEmailEncrypted) {
    await deleteLookup('email', oldEmailEncrypted);
  }
  if (newPhoneEncrypted && oldPhoneEncrypted && newPhoneEncrypted !== oldPhoneEncrypted) {
    await deleteLookup('phone', oldPhoneEncrypted);
  }
  if (newUsernameEncrypted && oldUsernameEncrypted && newUsernameEncrypted !== oldUsernameEncrypted) {
    await deleteLookup('username', oldUsernameEncrypted);
  }

  return {
    userId: id,
    updatedFields: Object.keys(payload),
  };
}

async function softDeleteUser(id) {
  console.info('[users] Delete requested');
  validateDeleteId(id);
  const existing = await fetchUserById(id);
  if (!existing || existing.isdeleted === true) {
    throw new HttpError(404, 'User not found.');
  }

  await execute(
    'UPDATE user SET isdeleted = ?, updateddate = ?, updatedby = ? WHERE id = ?',
    [true, nowUtcString(), id, id],
  );
  return { userId: id };
}

// SSO External Identity Functions
const EXTERNAL_ID_LOOKUP_QUERY = `
  SELECT userid
  FROM user_external_identity_lookup_for_testing
  WHERE provider = ? AND idtype = ? AND externalid = ?
`;

const EXTERNAL_ID_CHECK_QUERY = `
  SELECT userid
  FROM usr_external_identity
  WHERE userid = ? AND provider = ? AND idtype = ?
  LIMIT 1
`;

const EXTERNAL_ID_INSERT_QUERY = `
  INSERT INTO usr_external_identity (userid, idtype, provider, externalid, originalidtype, originalprovider, originalexternalid)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const EXTERNAL_ID_LOOKUP_INSERT_QUERY = `
  INSERT INTO user_external_identity_lookup_for_testing (provider, idtype, externalid, userid)
  VALUES (?, ?, ?, ?)
`;

/**
 * Resolve user by external identity (provider + idtype + externalid)
 * Returns user if external identity already mapped, null otherwise
 */
async function resolveUserByExternalIdentity(provider, idtype, externalid) {
  console.info(`[sso] Resolving user by external identity: ${provider}/${idtype}/${externalid}`);

  const result = await execute(EXTERNAL_ID_LOOKUP_QUERY, [provider, idtype, externalid]);
  if (result.rows.length === 0) {
    console.info(`[sso] No user found for ${provider}/${idtype}/${externalid}`);
    return null;
  }

  const userId = result.rows[0].userid;
  const user = await fetchUserById(userId);
  if (!user || user.isdeleted === true) {
    return null;
  }

  console.info(`[sso] Found user: ${userId}`);
  return user;
}

/**
 * Link external identity to existing user
 * Inserts into usr_external_identity and user_external_identity_lookup_for_testing
 * Throws error if already linked
 */
async function linkExternalIdentity(userId, externalIdentity) {
  const { provider, idtype, externalid, originalProvider, originalIdtype, originalExternalid } = externalIdentity;

  console.info(`[sso] Linking external identity to user ${userId}: ${provider}/${idtype}`);

  // Check for duplicate
  const checkResult = await execute(EXTERNAL_ID_CHECK_QUERY, [userId, provider, idtype]);
  if (checkResult.rows.length > 0) {
    throw new HttpError(409, 'External identity already linked to this user', {
      errorCode: 409,
      error: 'Conflict',
    });
  }

  // Insert into usr_external_identity
  await execute(EXTERNAL_ID_INSERT_QUERY, [
    userId,
    idtype,
    provider,
    externalid,
    originalIdtype || null,
    originalProvider || null,
    originalExternalid || null,
  ]);

  // Insert into user_external_identity_lookup_for_testing (reverse index)
  await execute(EXTERNAL_ID_LOOKUP_INSERT_QUERY, [provider, idtype, externalid, userId]);

  console.info(`[sso] External identity linked successfully`);
}

/**
 * Resolve or create user from SSO provider
 * Returns: {user, action: 'EXISTING'|'LINKED'|'CREATED'|'CONFLICT', conflict?}
 */
async function resolveSsoUser(ssoUser) {
  const { provider, idtype, externalid, email, emailVerified, phone, phoneVerified, firstname, lastname } = ssoUser;

  console.info(`[sso] Resolving SSO user: ${provider}/${externalid}`);

  // STEP 1: Check if external identity already mapped in our user_external_identity_lookup_for_testing table. This means that the user has logged in to our iam system atleast once successfully.
  const existingUser = await resolveUserByExternalIdentity(provider, idtype, externalid);
  if (existingUser) {
    console.info(`[sso] User already exists with this external identity: ${existingUser.id}`);
    return { user: existingUser, action: 'EXISTING' };
  }

  // STEP 2: Try safe auto-linking with verified email
  if (emailVerified && isNonEmptyString(email)) {
    try {
      const userByEmail = await getUser({ email });
      if (userByEmail) {
        console.info(`[sso] Found existing user by verified email, linking...`);
        await linkExternalIdentity(userByEmail.id, { provider, idtype, externalid });
        return { user: userByEmail, action: 'LINKED', linkedVia: 'email' };
      }
    } catch (err) {
      if (!(err instanceof HttpError && err.statusCode === 404)) throw err;
    }
  }

  // STEP 3: Try safe auto-linking with verified phone
  if (phoneVerified && isNonEmptyString(phone)) {
    try {
      const userByPhone = await getUser({ phone });
      if (userByPhone) {
        console.info(`[sso] Found existing user by verified phone, linking...`);
        await linkExternalIdentity(userByPhone.id, { provider, idtype, externalid });
        return { user: userByPhone, action: 'LINKED', linkedVia: 'phone' };
      }
    } catch (err) {
      if (!(err instanceof HttpError && err.statusCode === 404)) throw err;
    }
  }

  // STEP 4: Check for unverified email conflicts
  if (isNonEmptyString(email) && !emailVerified) {
    try {
      const userByEmail = await getUser({ email });
      if (userByEmail) {
        const username = userByEmail.username ? decryptStoredField(userByEmail.username, 'username') : 'unknown';
        return {
          action: 'CONFLICT',
          conflict: {
            reason: 'unverified_email_conflict',
            existingUserIds: [userByEmail.id],
            existingUsernames: [username],
            requestedEmail: email,
            message: 'Cannot auto-link unverified email. User account exists with this email.',
          },
        };
      }
    } catch (err) {
      if (!(err instanceof HttpError && err.statusCode === 404)) throw err;
    }
  }

  // STEP 5: Check for unverified phone conflicts
  if (isNonEmptyString(phone) && !phoneVerified) {
    try {
      const userByPhone = await getUser({ phone });
      if (userByPhone) {
        const username = userByPhone.username ? decryptStoredField(userByPhone.username, 'username') : 'unknown';
        return {
          action: 'CONFLICT',
          conflict: {
            reason: 'unverified_phone_conflict',
            existingUserIds: [userByPhone.id],
            existingUsernames: [username],
            requestedPhone: phone,
            message: 'Cannot auto-link unverified phone. User account exists with this phone.',
          },
        };
      }
    } catch (err) {
      if (!(err instanceof HttpError && err.statusCode === 404)) throw err;
    }
  }

  // STEP 6: Create new user
  console.info(`[sso] Creating new user from SSO`);
  const newUser = await createUser({
    firstname: firstname || 'SSO',
    lastname: lastname || 'User',
    email: emailVerified ? email : null,
    phone: phoneVerified ? phone : null,
    dob: '1990-01-01', // Default for SSO
    status: 1, // Active
  });

  const createdUser = await fetchUserById(newUser.userId);
  await linkExternalIdentity(createdUser.id, { provider, idtype, externalid });

  return { user: createdUser, action: 'CREATED' };
}

module.exports = {
  createUser,
  formatUserForResponse,
  formatWriteResponseFields,
  getUser,
  parseBooleanQueryFlag,
  softDeleteUser,
  updateUser,
  resolveUserByExternalIdentity,
  linkExternalIdentity,
  resolveSsoUser,
};
