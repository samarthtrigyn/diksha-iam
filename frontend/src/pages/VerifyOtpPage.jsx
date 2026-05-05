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

      // Verify OTP
      const result = await postVerifyOtp(txnId, identifier, otp, codeChallenge, redirectUri);

      if (result.nextAction === 'SET_PASSWORD') {
        // New flow: redirect to custom password setup page
        sessionStorage.setItem('setup_token', result.setupToken);
        sessionStorage.setItem('pkce_challenge', codeChallenge);
        navigate(`/auth/setup-password?token=${result.setupToken}`);
      } else if (result.nextAction === 'KEYCLOAK_LOGIN') {
        // Redirect to Keycloak auth (PKCE flow)
        window.location.href = result.authUrl;
      } else {
        setError('Unexpected response from server');
      }
    } catch (err) {
      console.error('OTP verification error:', err);
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
