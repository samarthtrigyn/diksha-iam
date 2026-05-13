/**
 * Validate request body fields for each OIDC endpoint
 * Returns 400 with standardized error if any required fields are missing/invalid
 */

export function validateLoginInit(req, res, next) {
  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: 'identifier is required (email, phone, or username)',
      statusCode: 400
    });
  }
  next();
}

export function validateLoginPassword(req, res, next) {
  const { txnId, password } = req.body;
  const errors = [];
  if (!txnId || typeof txnId !== 'string') errors.push('txnId');
  if (!password || typeof password !== 'string') errors.push('password');
  if (errors.length) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: `${errors.join(', ')} ${errors.length > 1 ? 'are' : 'is'} required`,
      statusCode: 400
    });
  }
  next();
}

export function validateCallback(req, res, next) {
  const { code, state } = req.query;
  const errors = [];
  if (!code) errors.push('code');
  if (!state) errors.push('state');
  if (errors.length) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: `${errors.join(', ')} ${errors.length > 1 ? 'are' : 'is'} required in query params`,
      statusCode: 400
    });
  }
  next();
}

export function validateRefresh(req, res, next) {
  // Refresh token is optional in body (can come from cookie), so always pass
  next();
}

export function validateUsersResolve(req, res, next) {
  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: 'identifier is required (email, phone, username, or SSO subject)',
      statusCode: 400
    });
  }
  next();
}

export function validatePasswordSetupInit(req, res, next) {
  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: 'identifier is required',
      statusCode: 400
    });
  }
  next();
}

export function validatePasswordSetupComplete(req, res, next) {
  const { txnId, otp } = req.body;
  const errors = [];
  if (!txnId || typeof txnId !== 'string') errors.push('txnId');
  if (!otp || typeof otp !== 'string') errors.push('otp');
  if (errors.length) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: `${errors.join(', ')} ${errors.length > 1 ? 'are' : 'is'} required`,
      statusCode: 400
    });
  }
  if (!/^\d{4,8}$/.test(otp)) {
    return res.status(400).json({
      error: 'invalid_request',
      errorDescription: 'otp must be 4-8 digits',
      statusCode: 400
    });
  }
  next();
}
