/**
 * Input Sanitization Middleware
 * Removes XSS attacks and invalid characters from user input
 */

import xss from 'xss';

/**
 * Sanitize string input
 * Removes dangerous HTML/JavaScript while preserving safe content
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  // Remove XSS attempts
  return xss(str, {
    whiteList: {}, // No HTML tags allowed
    stripIgnoredTag: true,
    stripLeakedAttrs: true
  }).trim();
}

/**
 * Recursively sanitize object values
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    // Don't sanitize keys, only values
    if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Middleware to sanitize request body and query parameters
 */
export function inputSanitizer(req, res, next) {
  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize params
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }

  next();
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (basic validation)
 * Accepts 10-15 digits, with optional +, -, spaces
 */
export function isValidPhone(phone) {
  const phoneRegex = /^[\d\s\-\+()]{10,15}$/;
  return phoneRegex.test(phone);
}

/**
 * Validate username format
 * Alphanumeric, underscore, hyphen, 3-30 characters
 */
export function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_\-]{3,30}$/;
  return usernameRegex.test(username);
}

/**
 * Validate identifier (email, phone, or username)
 */
export function isValidIdentifier(identifier) {
  return (
    isValidEmail(identifier) ||
    isValidPhone(identifier) ||
    isValidUsername(identifier)
  );
}

/**
 * Validate password strength
 * Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character
 */
export function isValidPassword(password) {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
}

/**
 * Get password strength feedback
 */
export function getPasswordFeedback(password) {
  const feedback = [];
  
  if (password.length < 8) feedback.push('At least 8 characters');
  if (!/[a-z]/.test(password)) feedback.push('At least 1 lowercase letter');
  if (!/[A-Z]/.test(password)) feedback.push('At least 1 uppercase letter');
  if (!/\d/.test(password)) feedback.push('At least 1 digit');
  if (!/[@$!%*?&]/.test(password)) feedback.push('At least 1 special character (@$!%*?&)');

  return feedback;
}

export default {
  inputSanitizer,
  sanitizeString,
  sanitizeObject,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  isValidIdentifier,
  isValidPassword,
  getPasswordFeedback
};
