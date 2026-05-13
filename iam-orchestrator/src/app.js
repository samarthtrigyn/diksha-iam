import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { CORS_ORIGINS } from './config/index.js';
import { responseLogger } from './middleware/responseLogger.js';
// Phase 3: Security Middleware
import { securityHeadersConfig, customSecurityHeaders, corsConfig } from './middleware/securityHeaders.js';
import { inputSanitizer } from './middleware/inputSanitizer.js';
import { globalLimiter, strictLimiter, veryStrictLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './utils/errorHandler.js';
// Routes
import healthRouter from './routes/health.js';
import loginRouter from './routes/login.js';
import activationRouter from './routes/activation.js';
import callbackRouter from './routes/callback.js';
import meRouter from './routes/me.js';
import logoutRouter from './routes/logout.js';
import ssoRouter from './routes/sso.js';
import tokenExchangeRouter from './routes/tokenExchange.js';
// Auth routes (new OIDC contract)
import loginInitRouter from './routes/auth/loginInit.js';
import loginPasswordRouter from './routes/auth/loginPassword.js';
import refreshRouter from './routes/auth/refresh.js';
// Password setup routes
import passwordSetupInitRouter from './routes/password/setupInit.js';
import passwordSetupCompleteRouter from './routes/password/setupComplete.js';
// Users routes
import usersResolveRouter from './routes/users/resolve.js';

const app = express();

// ──────────────────────────────────────────────────────────────────────────────
// Phase 3: Security Middleware (FIRST - before other middleware)
// ──────────────────────────────────────────────────────────────────────────────
app.use(securityHeadersConfig()); // Helmet.js security headers
app.use(customSecurityHeaders); // Custom security headers
app.use(globalLimiter); // Global rate limiting (100 req/15min per IP)

// ──────────────────────────────────────────────────────────────────────────────
// Core Middleware
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors(corsConfig())); // Improved CORS config
app.use(express.json({ limit: '10kb' })); // Limit request body size
app.use(cookieParser()); // Parse cookies from requests
app.use(inputSanitizer); // XSS prevention & input sanitization
app.use(responseLogger);

// ──────────────────────────────────────────────────────────────────────────────
// Routes (Legacy)
// ──────────────────────────────────────────────────────────────────────────────
app.use(healthRouter);
app.use(loginRouter);
app.use(activationRouter);
app.use(callbackRouter);
app.use(meRouter);
app.use(logoutRouter);
app.use(ssoRouter);
app.use(tokenExchangeRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Routes (New OIDC Contract) with Rate Limiting
// ──────────────────────────────────────────────────────────────────────────────
// Apply strict rate limiting to sensitive login endpoints
app.use('/iam/auth/login/init', strictLimiter);
app.use('/iam/auth/login/password', strictLimiter);

// Apply very strict rate limiting to OTP and password setup endpoints
app.use('/iam/password/setup/init', veryStrictLimiter);
app.use('/iam/password/setup/complete', veryStrictLimiter);

// Register routers
app.use(loginInitRouter);
app.use(loginPasswordRouter);
app.use(refreshRouter);
app.use(passwordSetupInitRouter);
app.use(passwordSetupCompleteRouter);
app.use(usersResolveRouter);

// ──────────────────────────────────────────────────────────────────────────────
// Phase 3: Global Error Handler (LAST - catch all errors)
// ──────────────────────────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
