import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../styles/SetupPassword.css';

export default function SetupPasswordPage() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing setup token');
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      // Get codeChallenge from sessionStorage (set by VerifyOtpPage)
      const codeChallenge = sessionStorage.getItem('pkce_challenge');
      if (!codeChallenge) {
        setError('Session expired. Please try again.');
        return;
      }

      const response = await fetch('http://localhost:4000/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupToken: token,
          password,
          codeChallenge
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to set password');
        return;
      }

      if (data.nextAction === 'KEYCLOAK_LOGIN') {
        // Store auth state and redirect to Keycloak
        sessionStorage.setItem('oauth_state', data.state);
        sessionStorage.setItem('setup_token_used', token);
        window.location.href = data.authUrl;
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-password-container">
      <div className="setup-password-left"></div>
      <div className="setup-password-right">
        <div className="setup-password-form-wrapper">
          <div className="setup-password-header">
            <h1>Create Password</h1>
            <p>Set a strong password for your account</p>
          </div>

          {error && <div className="setup-password-error">{error}</div>}

          <form onSubmit={handleSubmit} className="setup-password-form">
            <div className="setup-password-field">
              <label>Password</label>
              <div className="setup-password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="setup-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <small>At least 8 characters</small>
            </div>

            <div className="setup-password-field">
              <label>Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="setup-password-button"
              disabled={loading}
            >
              {loading ? 'Setting up...' : 'Create Password'}
            </button>
          </form>

          <div className="setup-password-requirements">
            <h4>Password Requirements:</h4>
            <ul>
              <li>At least 8 characters</li>
              <li>Mix of uppercase and lowercase letters</li>
              <li>Include numbers and special characters</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
