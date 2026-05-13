import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import '../styles/SetupPassword.css';
import { postPasswordSetupInit } from '../utils/api';

export default function SetupPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Legacy: if a token is in the URL, show an error — this flow is no longer supported
  const legacyToken = searchParams.get('token');

  useEffect(() => {
    if (legacyToken) {
      setError('This setup link has expired. Please use the Login page to restart password setup.');
    }
  }, [legacyToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim()) {
      setError('Please enter your email or phone number');
      return;
    }

    setLoading(true);

    try {
      // Initiate password setup — sends OTP to user
      const result = await postPasswordSetupInit(identifier.trim());

      if (result.txnId) {
        // Navigate to OTP verification page with txnId
        navigate('/verify-otp', {
          state: {
            txnId: result.txnId,
            maskedIdentifier: result.maskedIdentifier || identifier
          }
        });
      } else {
        setError('Unexpected response from server');
      }
    } catch (err) {
      setError(err.errorDescription || err.error || err.message || 'Failed to initiate password setup');
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
            <h1>Setup Password</h1>
            <p>Enter your registered email or phone to receive a verification code</p>
          </div>

          {error && <div className="setup-password-error">{error}</div>}

          <form onSubmit={handleSubmit} className="setup-password-form">
            <div className="setup-password-field">
              <label>Email or Phone Number</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Enter email or mobile number"
                disabled={loading}
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="setup-password-button"
              disabled={loading}
            >
              {loading ? 'Sending OTP...' : 'Send Verification Code'}
            </button>
          </form>

          <div className="setup-password-requirements">
            <p style={{ fontSize: '14px', color: '#666' }}>
              We'll send a one-time password to verify your identity. After verification,
              you'll be redirected to set your password.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
