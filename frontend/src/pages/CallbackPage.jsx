import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAuthCallback } from '../utils/api';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const callbackFired = useRef(false);

  useEffect(() => {
    if (callbackFired.current) return;
    callbackFired.current = true;
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const ssoSuccess   = searchParams.get('sso_success');
      const code         = searchParams.get('code');
      const errorParam   = searchParams.get('error');
      const returnedState = searchParams.get('state');
      const storedState  = sessionStorage.getItem('oauth_state');

      // ── SSO redirect: orchestrator already set session cookie, just navigate ──
      if (ssoSuccess === 'true') {
        console.log('[Callback] SSO session established via cookie, redirecting to dashboard');
        sessionStorage.removeItem('oauth_state');
        sessionStorage.removeItem('sso_provider');
        navigate('/dashboard');
        return;
      }

      // Handle provider error redirect
      if (errorParam) {
        const errorDesc = searchParams.get('error_description') || errorParam;
        console.error('[Callback] Provider returned error:', errorParam, errorDesc);
        setError(`Authentication error: ${errorDesc}`);
        setLoading(false);
        return;
      }

      if (!code) {
        setError('No authorization code received from provider');
        setLoading(false);
        return;
      }

      // Validate state to prevent CSRF
      if (storedState && returnedState && storedState !== returnedState) {
        console.error('[Callback] State mismatch:', { storedState, returnedState });
        setError('State mismatch – please try logging in again.');
        setLoading(false);
        return;
      }
      sessionStorage.removeItem('oauth_state');

      if (!returnedState) {
        setError('State parameter missing from callback');
        setLoading(false);
        return;
      }

      // ── Keycloak callback: GET /iam/auth/callback?code=&state= ──
      console.log('[Callback] Handling Keycloak callback via GET');
      await handleKeycloakCallback(code, returnedState);
    } catch (err) {
      console.error('[Callback] Error:', err);
      setError(err.error || err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  /**
   * Exchange authorization code with the orchestrator (GET request).
   * Session is established as HttpOnly cookie; no tokens stored client-side.
   */
  const handleKeycloakCallback = async (code, state) => {
    try {
      console.log('[Callback] Calling GET /iam/auth/callback...');
      const sessionContext = await getAuthCallback(code, state);
      console.log('[Callback] Session established:', { sessionId: sessionContext.sessionId, user: sessionContext.user?.username });

      if (!sessionContext) {
        setError('No session context returned from server');
        setLoading(false);
        return;
      }

      // Session is in HttpOnly cookie — no token storage needed client-side
      console.log('[Callback] Authentication successful, redirecting to dashboard');
      navigate('/dashboard');
    } catch (err) {
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Completing Sign-In</h1>
            <p>Please wait...</p>
          </div>
          <div className="loading">
            <div className="spinner"></div>
            <p>Completing sign-in...</p>
          </div>
        </div>
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Account Conflict</h1>
            <p>Resolve account linking</p>
          </div>
          <div className="error">
            <p><strong>{conflict.message}</strong></p>
            <p>Email: {conflict.requestedEmail || conflict.requestedPhone}</p>
            <p>Conflicting accounts:</p>
            <ul>
              {conflict.existingUserIds && conflict.existingUserIds.map((userId, idx) => (
                <li key={userId}>{conflict.existingUsernames?.[idx] || userId}</li>
              ))}
            </ul>
          </div>
          <p style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
            Cannot auto-link your {conflict.reason?.includes('email') ? 'email' : 'phone number'} because it's already associated with an account.
            Please contact support for account linking assistance.
          </p>
          <button onClick={() => navigate('/login')}>Back to Login</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Authentication Error</h1>
          </div>
          <div className="error">{error}</div>
          <button onClick={() => navigate('/login')}>Back to Login</button>
        </div>
      </div>
    );
  }

  return null;
}


export default function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const callbackFired = useRef(false);

  useEffect(() => {
    if (callbackFired.current) return;
    callbackFired.current = true;
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const ssoSession    = searchParams.get('sso_session');
      const code          = searchParams.get('code');
      const errorParam    = searchParams.get('error');
      const returnedState = searchParams.get('state');
      const storedState   = sessionStorage.getItem('oauth_state');
      const ssoProvider   = sessionStorage.getItem('sso_provider');

      // Handle SSO session redirect from orchestrator (Google/State SSO)
      if (ssoSession) {
        console.log('[Callback] Received SSO session from orchestrator redirect');
        try {
          const sessionContext = JSON.parse(atob(ssoSession.replace(/-/g, '+').replace(/_/g, '/')));
          console.log('[Callback] SSO session context:', sessionContext);

          sessionStorage.removeItem('oauth_state');
          sessionStorage.removeItem('sso_provider');

          if (sessionContext.flow === 'AUTHENTICATED') {
            const tokenData = sessionContext.tokens || {};
            sessionStorage.setItem('access_token', tokenData.accessToken || '');
            if (tokenData.refreshToken) sessionStorage.setItem('refresh_token', tokenData.refreshToken);
            if (tokenData.idToken) sessionStorage.setItem('id_token', tokenData.idToken);
            sessionStorage.setItem('user_profile', JSON.stringify(sessionContext.user));
            sessionStorage.setItem('token_decoded', JSON.stringify(sessionContext.user));
            if (tokenData.accessToken) setAuthToken(tokenData.accessToken);

            console.log('[Callback] SSO authentication successful, redirecting to dashboard');
            navigate('/dashboard');
          } else if (sessionContext.flow === 'CONFLICT_RESOLUTION_REQUIRED') {
            setConflict(sessionContext.conflict);
            setLoading(false);
          } else {
            setError('Unexpected SSO flow: ' + sessionContext.flow);
            setLoading(false);
          }
        } catch (parseErr) {
          console.error('[Callback] Failed to parse SSO session:', parseErr);
          setError('Failed to process SSO response');
          setLoading(false);
        }
        return;
      }

      console.log('[Callback] URL params:', { code: code?.substring(0, 20) + '...', errorParam, returnedState, storedState, ssoProvider });

      // Handle provider error redirect
      if (errorParam) {
        const errorDesc = searchParams.get('error_description') || errorParam;
        console.error('[Callback] Provider returned error:', errorParam, errorDesc);
        setError(`Authentication error: ${errorDesc}`);
        setLoading(false);
        return;
      }

      if (!code) {
        setError('No authorization code received from provider');
        setLoading(false);
        return;
      }

      // Validate state to prevent CSRF
      if (storedState && returnedState && storedState !== returnedState) {
        console.error('[Callback] State mismatch:', { storedState, returnedState });
        setError('State mismatch – please try logging in again.');
        setLoading(false);
        return;
      }
      sessionStorage.removeItem('oauth_state');

      if (!returnedState) {
        setError('State parameter missing from callback');
        setLoading(false);
        return;
      }

      // Route: Keycloak callback (password/OTP flows)
      console.log('[Callback] Handling Keycloak callback');
      await handleKeycloakCallback(code, returnedState);
    } catch (err) {
      console.error('[Callback] Error:', err);
      setError(err.error || err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  /**
   * Handle Keycloak OAuth2 callback
   * Exchanges code for tokens with the orchestrator
   */
  const handleKeycloakCallback = async (code, state) => {
    try {
      console.log('[Callback] Calling IAM orchestrator Keycloak callback endpoint...');
      const sessionContext = await postAuthCallback(code, state);
      console.log('[Callback] Received session context:', sessionContext);

      if (!sessionContext) {
        setError('No session context returned from server');
        setLoading(false);
        return;
      }

      const tokenData = sessionContext.tokens;
      if (!tokenData || !tokenData.accessToken) {
        console.error('[Callback] No access token in response:', sessionContext);
        setError('Failed to get access token from server');
        setLoading(false);
        return;
      }

      // Store tokens in sessionStorage
      sessionStorage.setItem('access_token', tokenData.accessToken);
      if (tokenData.refreshToken) {
        sessionStorage.setItem('refresh_token', tokenData.refreshToken);
      }
      if (tokenData.idToken) {
        sessionStorage.setItem('id_token', tokenData.idToken);
      }

      // Store user profile
      sessionStorage.setItem('user_profile', JSON.stringify(sessionContext.user));
      sessionStorage.setItem('token_decoded', JSON.stringify(sessionContext.user));

      // Set auth token for API calls
      setAuthToken(tokenData.accessToken);

      console.log('[Callback] Keycloak authentication successful, redirecting to dashboard');
      navigate('/dashboard');
    } catch (err) {
      throw err;
    }
  };

  /**
   * Handle SSO provider callback (Google, State SSO, etc.)
   * Exchanges code for session with user resolution
   */
  const handleSsoCallback = async (provider, code, state) => {
    try {
      console.log(`[Callback] Calling IAM orchestrator SSO callback for ${provider}...`);
      const result = await postSsoCallback(provider, code, state);
      console.log('[Callback] Received SSO result:', { flow: result.flow, action: result.ssoAction });

      if (result.flow === 'CONFLICT_RESOLUTION_REQUIRED') {
        // Unverified email/phone conflict – show conflict resolution UI
        console.warn('[Callback] SSO conflict detected:', result.conflict);
        setConflict({
          provider: result.ssoProvider,
          ...result.conflict
        });
        setLoading(false);
        return;
      }

      if (result.flow !== 'AUTHENTICATED') {
        setError(`Unexpected SSO flow: ${result.flow}`);
        setLoading(false);
        return;
      }

      // SSO authentication successful
      const tokenData = result.tokens;
      if (!tokenData || !tokenData.accessToken) {
        console.error('[Callback] No access token in SSO response:', result);
        setError('Failed to get access token from SSO');
        setLoading(false);
        return;
      }

      // Store tokens in sessionStorage (same format as Keycloak)
      sessionStorage.setItem('access_token', tokenData.accessToken);
      if (tokenData.refreshToken) {
        sessionStorage.setItem('refresh_token', tokenData.refreshToken);
      }
      if (tokenData.idToken) {
        sessionStorage.setItem('id_token', tokenData.idToken);
      }

      // Store user profile
      sessionStorage.setItem('user_profile', JSON.stringify(result.user));
      sessionStorage.setItem('token_decoded', JSON.stringify(result.user));

      // Set auth token for API calls
      setAuthToken(tokenData.accessToken);

      console.log(`[Callback] SSO authentication successful (${result.ssoAction}), redirecting to dashboard`);
      navigate('/dashboard');
    } catch (err) {
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Completing Sign-In</h1>
            <p>Please wait...</p>
          </div>
          <div className="loading">
            <div className="spinner"></div>
            <p>Completing sign-in...</p>
          </div>
        </div>
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Account Conflict</h1>
            <p>Resolve account linking</p>
          </div>
          <div className="error">
            <p><strong>{conflict.message}</strong></p>
            <p>Email: {conflict.requestedEmail || conflict.requestedPhone}</p>
            <p>Conflicting accounts:</p>
            <ul>
              {conflict.existingUserIds && conflict.existingUserIds.map((userId, idx) => (
                <li key={userId}>{conflict.existingUsernames?.[idx] || userId}</li>
              ))}
            </ul>
          </div>
          <p style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
            Cannot auto-link your {conflict.reason.includes('email') ? 'email' : 'phone number'} because it's already associated with an account.
            Please contact support for account linking assistance.
          </p>
          <button onClick={() => navigate('/login')}>Back to Login</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Authentication Error</h1>
          </div>
          <div className="error">{error}</div>
          <button onClick={() => navigate('/login')}>Back to Login</button>
        </div>
      </div>
    );
  }

  return null;
}
