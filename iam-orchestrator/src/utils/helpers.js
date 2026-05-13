/**
 * Return a string like `[L42]` with the caller's column number for debug logging.
 */
export const getLineNum = () => {
  try {
    const stack = new Error().stack.split('\n')[2];
    const match = stack.match(/:\d+:(\d+)/);
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
 */
export const maskIdentifier = (id) =>
  isEmail(id)
    ? id.replace(/(.{2})[^@]*(@.*)/, '$1***$2')
    : id.replace(/(\d{2})\d*(\d{2})/, '$1****$2');
