import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory user database
// In production, this would be a real database
const users = new Map([
  ['ratul003@example.com', {
    id: uuidv4(),
    email: 'ratul003@example.com',
    phone: '9876543210',
    activationStatus: 'PASSWORD_PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  }],
  ['ratul002@example.com', {
    id: uuidv4(),
    email: 'ratul002@example.com',
    phone: '9876543211',
    activationStatus: 'PASSWORD_PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  }],
  ['test@example.com', {
    id: uuidv4(),
    email: 'test@example.com',
    phone: '9876543212',
    activationStatus: 'PASSWORD_PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  }]
]);

// In-memory OTP storage
const otps = new Map();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'iam-user-service' });
});

// Find user by email
app.get('/users', (req, res) => {
  const { email, phone, isEncrypted } = req.query;
  console.log(`[IAM] GET /users - email: ${email}, phone: ${phone}`);
  
  if (email) {
    const user = users.get(email);
    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: `User not found with email: ${email}`
      });
    }
    return res.json(user);
  }
  
  if (phone) {
    for (const [, user] of users) {
      if (user.phone === phone) {
        return res.json(user);
      }
    }
    return res.status(404).json({
      error: 'USER_NOT_FOUND',
      message: `User not found with phone: ${phone}`
    });
  }
  
  // Return all users if no filters
  const usersList = Array.from(users.values());
  res.json(usersList);
});

// Get user by ID
app.get('/users/:id', (req, res) => {
  const id = req.params.id;
  console.log(`[IAM] GET /users/${id}`);
  
  for (const [, user] of users) {
    if (user.id === id) {
      return res.json(user);
    }
  }
  
  res.status(404).json({
    error: 'USER_NOT_FOUND',
    message: `User not found with id: ${id}`
  });
});

// Create new user
app.post('/users', (req, res) => {
  const { email, phone, activationStatus = 'ACTIVE' } = req.body;
  console.log(`[IAM] POST /users - email: ${email}, phone: ${phone}`);
  
  if (!email || !phone) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Email and phone are required'
    });
  }
  
  if (users.has(email)) {
    return res.status(409).json({
      error: 'USER_ALREADY_EXISTS',
      message: `User already exists with email: ${email}`
    });
  }
  
  const newUser = {
    id: uuidv4(),
    email,
    phone,
    activationStatus,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  users.set(email, newUser);
  console.log(`[IAM] User created: ${email}`);
  
  res.status(201).json(newUser);
});

// Generate OTP for user
app.post('/otp/generate', (req, res) => {
  const { request: { key, type } } = req.body;
  console.log(`[IAM] POST /otp/generate - key: ${key}, type: ${type}`);
  
  if (!key || !type) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'key and type are required'
    });
  }
  
  // Find user by email or phone
  let user = null;
  if (type === 'email') {
    user = users.get(key);
  } else if (type === 'phone') {
    for (const [, u] of users) {
      if (u.phone === key) {
        user = u;
        break;
      }
    }
  }
  
  if (!user) {
    return res.status(404).json({
      error: 'USER_NOT_FOUND',
      message: `User not found with ${type}: ${key}`
    });
  }
  
  // Generate 6-digit OTP (in demo, always 123456 for testing)
  const otp = '123456';
  const txnId = uuidv4();
  
  // Store OTP with 10-minute expiry
  otps.set(txnId, {
    otp,
    userId: user.id,
    email: user.email,
    phone: user.phone,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  
  console.log(`[IAM] OTP generated for ${user.email}: ${otp} (txnId: ${txnId})`);
  
  res.json({
    result: {
      txnId,
      response: {
        key: key,
        type: type,
        expiresIn: 600 // seconds
      }
    }
  });
});

// Verify OTP
app.post('/otp/verify', (req, res) => {
  const { request: { txnId, otp, key, type } } = req.body;
  
  console.log(`[IAM] POST /otp/verify - txnId: ${txnId}, otp: ${otp}, key: ${key}, type: ${type}`);
  
  if (!txnId || !otp) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'txnId and otp are required'
    });
  }
  
  const otpRecord = otps.get(txnId);
  
  if (!otpRecord) {
    return res.status(400).json({
      error: 'INVALID_TXN_ID',
      message: 'Transaction not found or expired'
    });
  }
  
  // Check expiry
  if (Date.now() > otpRecord.expiresAt) {
    otps.delete(txnId);
    return res.status(400).json({
      error: 'OTP_EXPIRED',
      message: 'OTP has expired'
    });
  }
  
  // Verify OTP (for demo, accept the generated OTP or '123456')
  if (otp !== otpRecord.otp && otp !== '123456') {
    return res.status(400).json({
      error: 'INVALID_OTP',
      message: 'OTP is incorrect'
    });
  }
  
  // Update user status if needed
  let user = null;
  for (const [, u] of users) {
    if (u.id === otpRecord.userId) {
      user = u;
      if (u.activationStatus === 'PENDING_PASSWORD') {
        u.activationStatus = 'PASSWORD_PENDING';
      }
      u.updatedAt = new Date();
      break;
    }
  }
  
  // Clean up OTP
  otps.delete(txnId);
  
  console.log(`[IAM] OTP verified for user ${otpRecord.userId}`);
  
  res.json({
    result: {
      txnId,
      response: {
        key: key || otpRecord.email,
        type: type || 'email',
        verified: true,
        user: user
      }
    }
  });
});

// Update user status
app.patch('/users/:id', (req, res) => {
  const userId = req.params.id;
  const { activationStatus } = req.body;
  
  console.log(`[IAM] PATCH /users/${userId} - activationStatus: ${activationStatus}`);
  
  let user = null;
  for (const [, u] of users) {
    if (u.id === userId) {
      user = u;
      break;
    }
  }
  
  if (!user) {
    return res.status(404).json({
      error: 'USER_NOT_FOUND',
      message: `User not found with id: ${userId}`
    });
  }
  
  if (activationStatus) {
    user.activationStatus = activationStatus;
  }
  
  user.updatedAt = new Date();
  
  res.json(user);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[IAM] Error:', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Endpoint not found: ${req.method} ${req.path}`
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`IAM User Service running on http://0.0.0.0:${PORT}`);
  console.log(`${'='.repeat(60)}\n`);
});
