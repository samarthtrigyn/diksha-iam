import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { postVerifyOtp } from '../utils/api';
import { getPKCE } from '../utils/pkce';

export default function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const txnId = location.state?.txnId || sessionStorage.getItem('txnId');
  const maskedIdentifier = location.state?.maskedIdentifier;
  const identifier = sessionStorage.getItem('login_identifier');
  const codeChallenge = sessionStorage.getItem('code_challenge');
  const redirectUri = `${window.location.origin}/auth/callback`;

  if (!txnId || !identifier || !codeChallenge) {
    return (
      <div className="container">
        <div className="card">
          <div className="error">
            Invalid session. Please start over.
          </div>
          <button onClick={() => navigate('/login')}>Go Back to Login</button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!otp.trim()) {
        setError('Please enter OTP');
        setLoading(false);
        return;
      }

      console.log('[VerifyOTP] Submitting OTP verification', {
        txnId,
        identifier: identifier?.substring(0, 5) + '***',
        codeChallenge: codeChallenge?.substring(0, 20) + '...',
        redirectUri
      });

      // Verify OTP
      const result = await postVerifyOtp(txnId, identifier, otp, codeChallenge, redirectUri);

      console.log('[VerifyOTP] Full result object:', result);
      console.log('[VerifyOTP] Result type:', typeof result);
      console.log('[VerifyOTP] Result keys:', Object.keys(result || {}));
      console.log('[VerifyOTP] Result.nextAction:', result?.nextAction);
      console.log('[VerifyOTP] Result.authUrl:', result?.authUrl?.substring?.(0, 100) || 'undefined');

      if (!result) {
        console.error('[VerifyOTP] Result is null or undefined!');
        setError('Server returned empty response');
        return;
      }

      if (result.nextAction === 'SET_PASSWORD') {
        // The authUrl already contains a signed activation_token.
        // Keycloak's custom authenticator will validate it, authenticate the user,
        // and immediately show the Update Password page — no custom form needed.
        console.log('[VerifyOTP] Redirecting to Keycloak with activation_token');
        console.log('[VerifyOTP] authUrl is defined:', !!result.authUrl);
        
        if (!result.authUrl) {
          console.error('[VerifyOTP] authUrl is undefined!');
          setError('Failed to generate Keycloak authorization URL');
          return;
        }
        
        sessionStorage.setItem('oauth_state', result.state);
        window.location.href = result.authUrl;
      } else if (result.nextAction === 'KEYCLOAK_LOGIN') {
        // Normal active-user redirect
        console.log('[VerifyOTP] Redirecting to Keycloak login');
        sessionStorage.setItem('oauth_state', result.state);
        window.location.href = result.authUrl;
      } else {
        console.error('[VerifyOTP] Unexpected nextAction:', result.nextAction);
        setError('Unexpected response from server: ' + (result.nextAction || 'none'));
      }
    } catch (err) {
      console.error('[VerifyOTP] Error during OTP verification:', err);
      console.error('[VerifyOTP] Error type:', typeof err);
      console.error('[VerifyOTP] Error keys:', Object.keys(err || {}));
      setError(err.error || err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      {/* Left Hero Panel */}
      <div className="auth-left">
        <div className="auth-left-content">
          <div className="diksha-logo">📚</div>
          <h2>Building Futures</h2>
          <p>Join millions of students and teachers transforming education through technology and innovation</p>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="auth-right">
        <div className="card">
          <div className="header">
            <h1>Verify OTP</h1>
            <p>Enter OTP sent to {maskedIdentifier || identifier}</p>
          </div>

          {error && <div className="error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="otp">One-Time Password*</label>
              <input
                id="otp"
                type="text"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength="6"
                disabled={loading}
                autoFocus
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/login')}
              disabled={loading}
            >
              Back to Login
            </button>

            <div className="demo-otp">
              Demo OTP: 123456
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
