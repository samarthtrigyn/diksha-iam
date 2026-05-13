import express from 'express';
import cors from 'cors';
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

const app = express();

// ──────────────────────────────────────────────────────────────────────────────
// Core Middleware
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
app.use(responseLogger);

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────
app.use(healthRouter);
app.use(loginRouter);
app.use(activationRouter);
app.use(callbackRouter);
app.use(meRouter);
app.use(logoutRouter);
app.use(ssoRouter);
app.use(tokenExchangeRouter);

export default app;
