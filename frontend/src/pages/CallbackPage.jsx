import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { postAuthCallback, setAuthToken } from '../utils/api';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const callbackFired = useRef(false);

  useEffect(() => {
    if (callbackFired.current) return;
    callbackFired.current = true;
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const code          = searchParams.get('code');
      const errorParam    = searchParams.get('error');
      const returnedState = searchParams.get('state');
      const storedState   = sessionStorage.getItem('oauth_state');

      console.log('[Callback] URL params:', { code: code?.substring(0, 20) + '...', errorParam, returnedState, storedState });

      // Handle Keycloak error redirect
      if (errorParam) {
        const errorDesc = searchParams.get('error_description') || errorParam;
        console.error('[Callback] Keycloak returned error:', errorParam, errorDesc);
        setError(`Authentication error: ${errorDesc}`);
        setLoading(false);
        return;
      }

      if (!code) {
        setError('No authorization code received from Keycloak');
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

      // Call IAM orchestrator callback endpoint
      // The orchestrator handles code exchange with Keycloak using server-side PKCE
      console.log('[Callback] Calling IAM orchestrator callback endpoint...');
      const sessionContext = await postAuthCallback(code, returnedState);
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

      // Set auth token for API calls
      setAuthToken(tokenData.accessToken);

      console.log('[Callback] Authentication successful, redirecting to dashboard');
      // Redirect to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('[Callback] Error:', err);
      setError(err.error || err.message || 'Authentication failed');
      setLoading(false);
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
