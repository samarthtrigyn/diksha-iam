import dotenv from 'dotenv';

dotenv.config();

// ──────────────────────────────────────────────────────────────────────────────
// Core
// ──────────────────────────────────────────────────────────────────────────────
export const PORT = process.env.PORT || 4000;

// ──────────────────────────────────────────────────────────────────────────────
// IAM User Service
// ──────────────────────────────────────────────────────────────────────────────
export const IAM_SERVICE_URL = process.env.IAM_USER_SERVICE_URL || 'http://iam-service:3000';

// ──────────────────────────────────────────────────────────────────────────────
// Keycloak
// ──────────────────────────────────────────────────────────────────────────────
export const KEYCLOAK_URL        = process.env.KEYCLOAK_URL       || 'http://keycloak:8080';
export const KEYCLOAK_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8080';
export const KEYCLOAK_REALM      = process.env.KEYCLOAK_REALM     || 'diksha-demo';

// Service account for Admin API calls (client_credentials grant, NO admin password needed)
export const KC_ADMIN_CLIENT_ID     = process.env.KEYCLOAK_CLIENT_ID     || 'iam-admin-client';
export const KC_ADMIN_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'iam-admin-client-secret';

// Public/portal client used in OAuth2 authorization and token exchange flows
export const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_PORTAL_CLIENT_ID || 'diksha-portal';

// Shared secret for signing activation tokens (must match ACTIVATION_TOKEN_SECRET in Keycloak env)
export const ACTIVATION_TOKEN_SECRET = process.env.ACTIVATION_TOKEN_SECRET || 'change-me-in-production';

// ──────────────────────────────────────────────────────────────────────────────
// OTP
// ──────────────────────────────────────────────────────────────────────────────
export const USE_MOCK_OTP  = process.env.USE_MOCK_OTP === 'true';
export const MOCK_OTP_CODE = process.env.MOCK_OTP_CODE || '123456';

// ──────────────────────────────────────────────────────────────────────────────
// Frontend
// ──────────────────────────────────────────────────────────────────────────────
export const FRONTEND_REDIRECT_URI = process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173/auth/callback';

// ──────────────────────────────────────────────────────────────────────────────
// Redis
// ──────────────────────────────────────────────────────────────────────────────
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ──────────────────────────────────────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────────────────────────────────────
export const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');

// ──────────────────────────────────────────────────────────────────────────────
// Session Management
// ──────────────────────────────────────────────────────────────────────────────
export const SESSION_TTL              = parseInt(process.env.SESSION_TTL || '86400', 10); // 24 hours in seconds
export const SESSION_COOKIE_NAME      = process.env.SESSION_COOKIE_NAME || 'session_id';
export const SECURE_COOKIE_DOMAIN     = process.env.SECURE_COOKIE_DOMAIN || undefined;
export const SECURE_COOKIE_SECURE     = process.env.SECURE_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

// ──────────────────────────────────────────────────────────────────────────────
// JWT/Token Validation
// ──────────────────────────────────────────────────────────────────────────────
export const JWKS_URI = process.env.JWKS_URI || `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;

// ──────────────────────────────────────────────────────────────────────────────
// SSO Providers
// ──────────────────────────────────────────────────────────────────────────────
export const ORCHESTRATOR_URL     = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';
export const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_JWKS_URL      = 'https://www.googleapis.com/oauth2/v3/certs';
