import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeCodeForToken, setAuthToken, getMe } from '../utils/api';
import { getPKCE, clearPKCE } from '../utils/pkce';
import { jwtDecode } from 'jwt-decode';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const code          = searchParams.get('code');
      const errorParam    = searchParams.get('error');
      const returnedState = searchParams.get('state');
      const storedState   = sessionStorage.getItem('oauth_state');

      console.log('[Callback] URL params:', { code: code?.substring(0, 20) + '...', errorParam, returnedState, storedState });
      console.log('[Callback] sessionStorage keys:', Object.keys(sessionStorage));

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

      // Get PKCE code verifier
      const codeVerifier = getPKCE();
      console.log('[Callback] codeVerifier present:', !!codeVerifier);
      if (!codeVerifier) {
        setError('Session expired (PKCE verifier missing). Please start over.');
        setLoading(false);
        return;
      }

      // Get Keycloak configuration
      const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'diksha-portal';
      const redirectUri = `${window.location.origin}/auth/callback`;

      // Exchange code for token
      console.log('[Callback] Exchanging code for token...');
      const tokenData = await exchangeCodeForToken(code, codeVerifier, clientId, redirectUri);
      console.log('[Callback] Token exchange result keys:', Object.keys(tokenData || {}));

      if (!tokenData.access_token) {
        console.error('[Callback] No access_token in response:', tokenData);
        setError('Failed to get access token: ' + JSON.stringify(tokenData));
        setLoading(false);
        return;
      }

      // Store tokens in sessionStorage
      sessionStorage.setItem('access_token', tokenData.access_token);
      if (tokenData.refresh_token) {
        sessionStorage.setItem('refresh_token', tokenData.refresh_token);
      }
      if (tokenData.id_token) {
        sessionStorage.setItem('id_token', tokenData.id_token);
      }

      // Set auth token for API calls
      setAuthToken(tokenData.access_token);

      // Clear PKCE
      clearPKCE();

      // Fetch user profile from IAM
      console.log('[Callback] Fetching user profile...');
      try {
        const userProfile = await getMe();
        console.log('[Callback] User profile:', userProfile);
        sessionStorage.setItem('user_profile', JSON.stringify(userProfile));
        
        // Decode and store the access token for display
        try {
          const decoded = jwtDecode(tokenData.access_token);
          sessionStorage.setItem('token_decoded', JSON.stringify(decoded));
        } catch (e) {
          console.warn('Failed to decode token:', e);
        }

        // Redirect to dashboard
        navigate('/dashboard');
      } catch (profileError) {
        console.error('Failed to fetch user profile:', profileError);
        setError('Failed to fetch user profile: ' + (profileError.error || profileError.message));
        setLoading(false);
      }
    } catch (err) {
      console.error('Callback error:', err);
      setError(err.error || err.message || 'Authentication failed');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="header">
            <h1>Processing Login</h1>
            <p>Please wait...</p>
          </div>
          <div className="loading">
            <div className="spinner"></div>
            <p>Exchanging authorization code for tokens...</p>
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
