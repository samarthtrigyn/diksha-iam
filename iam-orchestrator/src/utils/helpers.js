/**
 * Return a string like `[L42]` with the caller's line number for debug logging.
 */
export const getLineNum = () => {
  try {
    const stack = new Error().stack.split('\n')[2];
    const match = stack.match(/:(\d+):\d+/);
    return match ? `[L${match[1]}]` : '';
  } catch {
    return '';
  }
};

/**
 * Check whether a string looks like an email address.
 */
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Mask an identifier for safe logging (e.g. "ra***@example.com" or "91****56").
 * Returns the input as-is if it's neither an email nor a phone number.
 */
export const maskIdentifier = (id) => {
  if (isEmail(id)) {
    return id.replace(/(.{2})[^@]*(@.*)/, '$1***$2');
  }
  if (/^\d{10}$/.test(id)) {
    return id.replace(/(\d{2})\d*(\d{2})/, '$1****$2');
  }
  return id;
};