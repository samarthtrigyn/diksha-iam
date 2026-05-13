import { v4 as uuidv4 } from 'uuid';
import sessionStore from '../stores/sessionStore.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Application session management service
 * Handles session creation, retrieval, rotation, and deletion
 */

export async function createSession(iamUserId, username, tokens, sessionTTL) {
  try {
    const sessionId = uuidv4();
    const createdAt = Date.now();
    const expiresAt = createdAt + (sessionTTL * 1000);

    const sessionData = {
      sessionId,
      iamUserId,
      username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      tokenType: tokens.tokenType || 'Bearer',
      expiresIn: tokens.expiresIn,
      createdAt,
      expiresAt
    };

    await sessionStore.set(sessionId, sessionData, sessionTTL);
    console.log(`[SESSION] Created session: ${sessionId} for user: ${iamUserId} (TTL: ${sessionTTL}s) ${getLineNum()}`);

    return { sessionId, ...sessionData };
  } catch (err) {
    console.error(`[SESSION] Error creating session ${getLineNum()}:`, err.message);
    throw err;
  }
}

export async function getSession(sessionId) {
  try {
    const session = await sessionStore.get(sessionId);
    if (!session) {
      console.warn(`[SESSION] Session not found: ${sessionId} ${getLineNum()}`);
      return null;
    }
    return session;
  } catch (err) {
    console.error(`[SESSION] Error retrieving session ${getLineNum()}:`, err.message);
    return null;
  }
}

export async function rotateSession(sessionId, newTokens, sessionTTL) {
  try {
    const session = await sessionStore.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const updatedSession = {
      ...session,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken || session.refreshToken,
      idToken: newTokens.idToken || session.idToken,
      expiresIn: newTokens.expiresIn,
      expiresAt: Date.now() + (sessionTTL * 1000)
    };

    await sessionStore.rotate(sessionId, updatedSession, sessionTTL);
    console.log(`[SESSION] Rotated session: ${sessionId} for user: ${session.iamUserId} ${getLineNum()}`);

    return updatedSession;
  } catch (err) {
    console.error(`[SESSION] Error rotating session ${getLineNum()}:`, err.message);
    throw err;
  }
}

export async function deleteSession(sessionId) {
  try {
    await sessionStore.delete(sessionId);
    console.log(`[SESSION] Deleted session: ${sessionId} ${getLineNum()}`);
  } catch (err) {
    console.error(`[SESSION] Error deleting session ${getLineNum()}:`, err.message);
  }
}
