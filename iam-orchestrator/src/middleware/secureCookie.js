import { getLineNum } from '../utils/helpers.js';

/**
 * Middleware and utilities for managing secure HttpOnly cookies
 * Cookies are marked secure (HTTPS only), HttpOnly (JS inaccessible), and SameSite=Strict
 */

export function setSecureCookie(res, cookieName, value, options = {}) {
  const {
    maxAge = 24 * 60 * 60 * 1000, // 24 hours
    secure = process.env.NODE_ENV === 'production',
    httpOnly = true,
    sameSite = 'Strict',
    domain = process.env.SECURE_COOKIE_DOMAIN || undefined
  } = options;

  const cookieOptions = {
    maxAge,
    secure,
    httpOnly,
    sameSite,
    path: '/'
  };

  if (domain) {
    cookieOptions.domain = domain;
  }

  res.cookie(cookieName, value, cookieOptions);
  console.log(`[COOKIE] Set ${cookieName} (secure=${secure}, httpOnly=${httpOnly}, sameSite=${sameSite}) ${getLineNum()}`);
}

export function clearSecureCookie(res, cookieName) {
  const cookieOptions = {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Strict',
    path: '/'
  };

  res.clearCookie(cookieName, cookieOptions);
  console.log(`[COOKIE] Cleared ${cookieName} ${getLineNum()}`);
}

export function getSessionIdFromCookie(req, cookieName = 'session_id') {
  const sessionId = req.cookies?.[cookieName];
  if (!sessionId) {
    console.warn(`[COOKIE] Session ID not found in cookies ${getLineNum()}`);
    return null;
  }
  return sessionId;
}
