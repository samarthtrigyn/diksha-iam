import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { CORS_ORIGINS } from './config/index.js';
import { responseLogger } from './middleware/responseLogger.js';
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

const app = express();

// ──────────────────────────────────────────────────────────────────────────────
// Core Middleware
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
app.use(cookieParser()); // Parse cookies from requests
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
// Routes (New OIDC Contract)
// ──────────────────────────────────────────────────────────────────────────────
app.use(loginInitRouter);
app.use(loginPasswordRouter);
app.use(refreshRouter);
app.use(passwordSetupInitRouter);
app.use(passwordSetupCompleteRouter);

export default app;
