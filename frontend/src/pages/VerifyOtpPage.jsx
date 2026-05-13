import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { postPasswordSetupComplete } from '../utils/api';

export default function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const txnId = location.state?.txnId || sessionStorage.getItem('txnId');
  const maskedIdentifier = location.state?.maskedIdentifier;

  if (!txnId) {
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

      console.log('[VerifyOTP] Submitting OTP verification', { txnId });

      // Verify OTP and complete password setup — server generates PKCE + activation URL
      const result = await postPasswordSetupComplete(txnId, otp);

      console.log('[VerifyOTP] Response:', result);

      if (!result) {
        console.error('[VerifyOTP] Result is null or undefined!');
        setError('Server returned empty response');
        return;
      }

      if (result.flow === 'ACTIVATION_REQUIRED' || result.flow === 'SET_PASSWORD') {
        // Redirect to Keycloak activation/set-password page with server-side PKCE
        console.log('[VerifyOTP] Redirecting to Keycloak authorization');
        
        if (!result.authUrl) {
          console.error('[VerifyOTP] authUrl is undefined!');
          setError('Failed to generate Keycloak authorization URL');
          return;
        }
        
        sessionStorage.setItem('oauth_state', result.state);
        window.location.href = result.authUrl;
      } else {
        console.error('[VerifyOTP] Unexpected flow:', result.flow);
        setError('Unexpected response from server: ' + (result.flow || 'unknown'));
      }
    } catch (err) {
      console.error('[VerifyOTP] Error during OTP verification:', err);
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
            <p>Verify your account once to continue</p>
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
