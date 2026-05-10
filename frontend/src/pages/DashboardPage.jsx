import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import jwtDecode from 'jwt-decode';
import { postLogout } from '../utils/api';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const [tokenDecoded, setTokenDecoded] = useState(null);
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const storedProfile = sessionStorage.getItem('user_profile');
    const storedToken = sessionStorage.getItem('token_decoded');
    const token = sessionStorage.getItem('access_token');

    if (!storedProfile || !token) {
      setError('Session expired. Please login again.');
      setTimeout(() => navigate('/login'), 2000);
      return;
    }

    try {
      setUserProfile(JSON.parse(storedProfile));
      if (storedToken) {
        setTokenDecoded(JSON.parse(storedToken));
      }
      setAccessToken(token);
    } catch (e) {
      setError('Failed to load profile: ' + e.message);
    }
  }, [navigate]);

  const handleLogout = async () => {
    try {
      const refreshToken = sessionStorage.getItem('refresh_token');
      const userProfile = sessionStorage.getItem('user_profile');
      let iamUserId = null;

      if (userProfile) {
        try {
          const parsed = JSON.parse(userProfile);
          iamUserId = parsed.iamUserId;
        } catch (e) {
          console.warn('Failed to parse user profile:', e.message);
        }
      }

      // Call logout endpoint to revoke tokens
      await postLogout(refreshToken, iamUserId);
      
      console.log('[Dashboard] Logout successful, redirecting to login');
      navigate('/login');
    } catch (err) {
      console.error('[Dashboard] Logout error:', err.message);
      // Clear session and redirect to login even if logout fails
      sessionStorage.clear();
      navigate('/login');
    }
  };

  if (error) {
    return (
      <div className="container">
        <div className="card">
          <div className="error">{error}</div>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="container">
        <div className="card">
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <h1>Welcome!</h1>
          <p>Your authentication was successful</p>
        </div>

        <div className="success">
          ✓ Successfully authenticated with Keycloak and IAM
        </div>

        {/* User Profile Section */}
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#333' }}>
            IAM User Profile
          </h2>
          <div className="profile-grid">
            <div className="profile-item">
              <label>First Name</label>
              <value>{userProfile.user?.firstname || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>Last Name</label>
              <value>{userProfile.user?.lastname || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>Email</label>
              <value>{userProfile.user?.email || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>Phone</label>
              <value>{userProfile.user?.phone || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>IAM User ID</label>
              <value style={{ fontSize: '12px' }}>{userProfile.user?.id || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>Activation Status</label>
              <value>{userProfile.user?.activationStatus || 'N/A'}</value>
            </div>
          </div>
        </div>

        {/* Roles and Orgs Section */}
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#333' }}>
            Roles & Organizations
          </h2>
          <div className="profile-grid">
            <div className="profile-item">
              <label>Roles</label>
              <value>{userProfile.roles?.join(', ') || 'N/A'}</value>
            </div>
            <div className="profile-item">
              <label>Org ID</label>
              <value>{userProfile.orgs?.[0]?.orgId || 'N/A'}</value>
            </div>
          </div>
        </div>

        {/* Keycloak Claims */}
        {userProfile.keycloak && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#333' }}>
              Keycloak Claims
            </h2>
            <div className="profile-grid">
              <div className="profile-item">
                <label>Subject (sub)</label>
                <value style={{ fontSize: '12px' }}>{userProfile.keycloak.sub || 'N/A'}</value>
              </div>
              <div className="profile-item">
                <label>Username</label>
                <value>{userProfile.keycloak.preferred_username || 'N/A'}</value>
              </div>
              <div className="profile-item">
                <label>Email</label>
                <value>{userProfile.keycloak.email || 'N/A'}</value>
              </div>
              <div className="profile-item">
                <label>Given Name</label>
                <value>{userProfile.keycloak.given_name || 'N/A'}</value>
              </div>
            </div>
          </div>
        )}

        {/* Token Display */}
        {tokenDecoded && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#333' }}>
              Decoded Access Token
            </h2>
            <div className="token-display">
              <code>{JSON.stringify(tokenDecoded, null, 2)}</code>
            </div>
          </div>
        )}

        {/* Raw Token */}
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ fontSize: '18px', marginBottom: '15px', color: '#333' }}>
            Access Token (JWT)
          </h2>
          <div className="token-display">
            <code>{accessToken}</code>
          </div>
        </div>

        <button onClick={handleLogout} style={{ background: '#dc3545' }}>
          Logout
        </button>
      </div>
    </div>
  );
}
