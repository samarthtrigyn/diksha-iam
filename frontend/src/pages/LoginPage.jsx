import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postLoginStart, setAuthToken } from '../utils/api';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate input
      if (!identifier.trim()) {
        setError('Please enter email, phone, or username');
        setLoading(false);
        return;
      }

      // Store identifier in sessionStorage for reference
      sessionStorage.setItem('login_identifier', identifier);

      // Call IAM login start
      const result = await postLoginStart(identifier, password);

      console.log('[LoginPage] Login result:', result);

      if (result.flow === 'USER_NOT_FOUND') {
        setError('User not found. Please check your email, phone, or username.');
      } else if (result.flow === 'PASSWORD_REQUIRED') {
        setError('Please enter your password.');
      } else if (result.flow === 'OTP_VERIFICATION') {
        // New/unactivated user – proceed to OTP verification
        sessionStorage.setItem('txnId', result.txnId);
        navigate('/verify-otp', {
          state: {
            txnId: result.txnId,
            maskedIdentifier: result.maskedIdentifier
          }
        });
      } else if (result.flow === 'AUTHENTICATED') {
        // Active user – Direct Grant succeeded, store tokens and go to dashboard
        setAuthToken(result.tokens.accessToken);
        sessionStorage.setItem('access_token', result.tokens.accessToken);
        sessionStorage.setItem('token_decoded', JSON.stringify(result.user));
        sessionStorage.setItem('user_profile', JSON.stringify(result.user));
        navigate('/dashboard');
      } else {
        setError('Unexpected response from server: ' + (result.flow || 'unknown'));
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.error || err.message || 'An error occurred during login');
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
          <div className="auth-tabs">
            <div className="auth-tab active">Login</div>
            <div className="auth-tab">Register</div>
          </div>

          <div className="header">
            <h1>Login</h1>
            <p>Enter DIKSHA ID / Email ID / Mobile Number</p>
          </div>

          {error && <div className="error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="identifier">Enter DIKSHA ID / Email ID / Mobile Number*</label>
              <input
                id="identifier"
                type="text"
                placeholder="enter DIKSHA ID, email, or mobile number"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Enter Your Password*</label>
              <div className="form-group-wrapper">
                <input
                  id="password"
                  type="password"
                  placeholder="enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <span className="password-toggle">👁️</span>
              </div>
            </div>

            <div className="form-footer">
              <label>
                <input type="checkbox" /> Remember me
              </label>
              <a href="#forgot">Forgot Password?</a>
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={(e) => {
                e.preventDefault();
                navigate('/login-otp');
              }}
              disabled={loading}
            >
              Login with OTP
            </button>

            <div className="social-login">
              <div className="social-divider">Or login with</div>
              <div className="social-buttons">
                <button className="social-btn" type="button" title="Meghalayan">
                  <span>🏛️<br/>Meghalayan</span>
                </button>
                <button className="social-btn" type="button" title="State System">
                  <span>🏢<br/>State System</span>
                </button>
                <button className="social-btn" type="button" title="Google">
                  <span>🔵<br/>Google</span>
                </button>
                <button className="social-btn" type="button" title="Apple">
                  <span>🍎<br/>Apple</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
