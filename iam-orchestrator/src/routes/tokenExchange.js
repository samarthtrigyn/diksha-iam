import { Router } from 'express';

const router = Router();

// POST /auth/token-exchange (DEPRECATED - kept for backwards compatibility)
router.post('/auth/token-exchange', async (req, res) => {
  console.warn(`[TOKEN-EXCHANGE] Deprecated endpoint called. Use POST /iam/auth/callback instead`);
  return res.status(410).json({
    error: 'This endpoint is deprecated. Use POST /iam/auth/callback instead.',
    hint: 'Frontend should send code and state to /iam/auth/callback, not this endpoint.'
  });
});

export default router;
