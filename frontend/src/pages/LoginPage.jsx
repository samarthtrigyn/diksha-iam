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
      storePKCE(codeVerifier);
      
      // Store identifier in sessionStorage for next step
      sessionStorage.setItem('login_identifier', identifier);
      sessionStorage.setItem('code_challenge', codeChallenge);

      // Call IAM login start
      const result = await postLoginStart(identifier);

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
        // Already active user, redirect to Keycloak
        window.location.href = result.redirectUrl;
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
      <div className="card">
        <div className="header">
          <h1>DIKSHA IAM Demo</h1>
          <p>Sign in to your account</p>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="identifier">Email or Phone</label>
            <input
              id="identifier"
              type="text"
              placeholder="your-email@example.com or 9876543210"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Continue'}
          </button>
        </form>

        <div className="text-sm mt-20 centered-text">
          Demo: Use <code>ratul003@example.com</code>
        </div>
      </div>
    </div>
  );
}
