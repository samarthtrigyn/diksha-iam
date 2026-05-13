import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postLoginInit, postLoginPassword } from '../utils/api';

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL || 'http://localhost:4000';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [txnId, setTxnId] = useState('');
  const [step, setStep] = useState('identifier'); // 'identifier' | 'password'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  /**
   * Initiate Google SSO login
   */
  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      console.log('[LoginPage] Initiating Google SSO login...');
      
      const response = await fetch(`${ORCHESTRATOR_URL}/iam/sso/google/login`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to initiate SSO: ${response.status}`);
      }

      const data = await response.json();
      console.log('[LoginPage] Got auth URL from orchestrator');

      // Store state in sessionStorage for validation on callback
      sessionStorage.setItem('oauth_state', data.state);
      sessionStorage.setItem('sso_provider', 'google');

      // Redirect to Google OAuth
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('[LoginPage] SSO login error:', err);
      setError(err.message || 'Failed to initiate Google login');
      setLoading(false);
    }
  };

  /**
   * Initiate State SSO login (Meghalayan, Karnataka, etc.)
   */
  const handleStateSsoLogin = async (stateCode) => {
    try {
      setLoading(true);
      console.log(`[LoginPage] Initiating ${stateCode} SSO login...`);

      const provider = `state_${stateCode}`;
      const response = await fetch(`${ORCHESTRATOR_URL}/iam/sso/${provider}/login`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to initiate SSO: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[LoginPage] Got auth URL from orchestrator for ${stateCode}`);

      // Store state in sessionStorage for validation on callback
      sessionStorage.setItem('oauth_state', data.state);
      sessionStorage.setItem('sso_provider', provider);

      // Redirect to State SSO provider
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('[LoginPage] SSO login error:', err);
      setError(err.message || `Failed to initiate ${stateCode} login`);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!identifier.trim()) {
        setError('Please enter email, phone, or username');
        setLoading(false);
        return;
      }

      if (step === 'identifier') {
        // ── STEP 1: Initiate login, determine flow ──
        const result = await postLoginInit(identifier.trim());
        console.log('[LoginPage] Login init result:', result);

        if (result.flow === 'DIRECT_GRANT') {
          // Active user – show password field
          setTxnId(result.txnId);
          setStep('password');
        } else if (result.flow === 'OTP_VERIFICATION') {
          // New/unactivated user – go to OTP page
          sessionStorage.setItem('txnId', result.txnId);
          navigate('/verify-otp', {
            state: { txnId: result.txnId, maskedIdentifier: result.maskedIdentifier }
          });
        } else {
          setError('Unexpected response from server: ' + (result.flow || 'unknown'));
        }
      } else {
        // ── STEP 2: Submit password for DIRECT_GRANT flow ──
        if (!password) {
          setError('Please enter your password');
          setLoading(false);
          return;
        }

        const result = await postLoginPassword(txnId, password);
        console.log('[LoginPage] Login password result:', result);

        if (result.activationStatus === 'ACTIVE' || result.user) {
          // Session is now in HttpOnly cookie — no need to store tokens in sessionStorage
          navigate('/dashboard');
        } else {
          setError('Login failed. Please try again.');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      if (err.error === 'user_not_found') {
        setError('User not found. Please check your email, phone, or username.');
      } else if (err.error === 'invalid_credentials') {
        setError('Incorrect password. Please try again.');
      } else {
        setError(err.errorDescription || err.error || err.message || 'An error occurred during login');
      }
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
                disabled={loading || step === 'password'}
                autoFocus
              />
            </div>

            {step === 'password' && (
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
                    autoFocus
                  />
                  <span className="password-toggle">👁️</span>
                </div>
              </div>
            )}

            <div className="form-footer">
              <label>
                <input type="checkbox" /> Remember me
              </label>
              <a href="#forgot">Forgot Password?</a>
            </div>

            <button type="submit" disabled={loading}>
              {loading ? 'Logging in...' : step === 'identifier' ? 'Continue' : 'Login'}
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
                <button
                  className="social-btn"
                  type="button"
                  title="Meghalayan SSO"
                  onClick={() => handleStateSsoLogin('meghalaya')}
                  disabled={loading}
                >
                  <span>🏛️<br/>Meghalayan</span>
                </button>
                <button
                  className="social-btn"
                  type="button"
                  title="State System"
                  onClick={() => handleStateSsoLogin('state')}
                  disabled={loading}
                >
                  <span>🏢<br/>State System</span>
                </button>
                <button
                  className="social-btn"
                  type="button"
                  title="Google"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                >
                  <span>🔵<br/>Google</span>
                </button>
                <button
                  className="social-btn"
                  type="button"
                  title="Coming soon"
                  disabled={true}
                >
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
