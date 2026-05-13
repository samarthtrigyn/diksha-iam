/**
 * Security Headers Middleware
 * Adds HTTP security headers to protect against common attacks
 */

import helmet from 'helmet';

/**
 * Comprehensive security headers configuration
 * Using helmet.js for OWASP top security headers
 */
export function securityHeadersConfig() {
  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'http://localhost:*', 'http://keycloak:*'],
        frameSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      },
      reportOnly: false // Change to true for testing
    },

    // Prevents browsers from MIME-sniffing
    noSniff: true,

    // Protects against clickjacking
    frameguard: {
      action: 'deny'
    },

    // Enables browser XSS protection
    xssFilter: true,

    // Referrer Policy
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    },

    // HSTS (HTTP Strict Transport Security)
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: false // Set to true only after ensuring no HSTS issues
    },

    // Hide X-Powered-By header
    hidePoweredBy: true,

    // Prevent DNS prefetch
    dnsPrefetchControl: {
      allow: false
    },

    // Disable client-side caching for sensitive pages
    noCache: false, // Keep false to allow caching control via individual routes

    // Additional custom headers
    permittedCrossDomainPolicies: {
      permittedPolicies: 'none'
    }
  });
}

/**
 * Custom security headers middleware
 * Adds additional headers beyond helmet
 */
export function customSecurityHeaders(req, res, next) {
  // Prevent content type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Disable browser feature policies
  res.setHeader('X-Frame-Options', 'DENY');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy (formerly Feature-Policy)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Remove server info
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');

  // API-specific headers
  res.setHeader('X-API-Version', '1.0');
  res.setHeader('Access-Control-Expose-Headers', 'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset');

  next();
}

/**
 * CORS configuration with security
 */
export function corsConfig() {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173', // Vite dev server
    'http://localhost:8080',
    'http://keycloak:8080',
    process.env.FRONTEND_URL || 'http://localhost:3000'
  ];

  return {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400 // 24 hours
  };
}

export default {
  securityHeadersConfig,
  customSecurityHeaders,
  corsConfig
};
