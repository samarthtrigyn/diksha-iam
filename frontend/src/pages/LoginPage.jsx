import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generatePKCE, storePKCE } from '../utils/pkce';
import { postLoginStart } from '../utils/api';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
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
        setError('Please enter email or phone number');
        setLoading(false);
        return;
      }

      // Generate PKCE
      const { codeVerifier, codeChallenge } = await generatePKCE();
      
      if (!codeChallenge) {
        setError('Failed to generate PKCE code challenge');
        setLoading(false);
        return;
      }
      
      storePKCE(codeVerifier);
      
      // Store identifier in sessionStorage for next step
      sessionStorage.setItem('login_identifier', identifier);
      sessionStorage.setItem('code_challenge', codeChallenge);

      // Call IAM login start — pass codeChallenge so server can build auth URL for active users
      const result = await postLoginStart(identifier, {
        codeChallenge,
        redirectUri: `${window.location.origin}/auth/callback`,
        clientId: 'diksha-portal'
      });

      if (result.nextAction === 'USER_NOT_FOUND') {
        setError('User not found. Please check your email or phone number.');
      } else if (result.nextAction === 'VERIFY_OTP') {
        // Proceed to OTP verification
        sessionStorage.setItem('txnId', result.txnId);
        navigate('/verify-otp', {
          state: {
            txnId: result.txnId,
            maskedIdentifier: result.maskedIdentifier
          }
        });
      } else if (result.nextAction === 'KEYCLOAK_LOGIN') {
        // Active user – redirect to Keycloak PKCE auth
        sessionStorage.setItem('oauth_state', result.state);
        window.location.href = result.authUrl;
      } else {
        setError('Unexpected response from server');
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
            <p>Enter Your Email ID/Mobile Number</p>
          </div>

          {error && <div className="error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="identifier">Enter Your Email ID/Mobile Number*</label>
              <input
                id="identifier"
                type="text"
                placeholder="enter your email id/mobile number"
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
