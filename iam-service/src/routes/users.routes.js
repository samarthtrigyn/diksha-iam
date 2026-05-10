const express = require('express');
const {
  createUserHandler,
  deleteUserHandler,
  getUserHandler,
  updateUserHandler,
} = require('../controllers/users.controller');
const {
  resolveUserByExternalIdentity,
  linkExternalIdentity,
  resolveSsoUser,
  formatUserForResponse,
  getUser,
} = require('../services/users.service');
const { HttpError } = require('../services/sso.service');

const router = express.Router();

router.post('/users', createUserHandler);
router.get('/users/:id', getUserHandler);
router.get('/users', getUserHandler);
router.patch('/users/:id', updateUserHandler);
router.delete('/users/:id', deleteUserHandler);

// SSO Routes
router.get('/users/external/:provider/:idtype/:externalid', async (req, res, next) => {
  try {
    const { provider, idtype, externalid } = req.params;
    const user = await resolveUserByExternalIdentity(provider, idtype, externalid);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      user: formatUserForResponse(user, false),
      action: 'EXISTING',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/sso-resolve', async (req, res, next) => {
  try {
    const result = await resolveSsoUser(req.body);

    // Handle conflict
    if (result.action === 'CONFLICT') {
      return res.status(409).json(result);
    }

    // Return user with action
    res.status(result.action === 'CREATED' ? 201 : 200).json({
      user: formatUserForResponse(result.user, false),
      action: result.action,
      linkedVia: result.linkedVia || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/link-external-identity', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user exists
    const user = await getUser({ id });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Link external identity
    await linkExternalIdentity(id, req.body);

    res.status(200).json({
      userId: id,
      linked: true,
      externalIdentity: req.body,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
