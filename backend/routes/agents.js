const express = require('express');

function createAgentRoutes({ agentService, authMiddleware }) {
  const router = express.Router();
  router.use(authMiddleware);

  router.get('/', async (req, res, next) => {
    try {
      const items = await agentService.listAgents({ ownerUserId: req.authUser.id });
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const created = await agentService.createAgent({
        ownerUserId: req.authUser.id,
        body: req.body,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/api-key', async (req, res, next) => {
    try {
      const result = await agentService.storeApiKey({
        ownerUserId: req.authUser.id,
        agentId: req.params.id,
        apiKey: req.body?.apiKey,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/endpoint', async (req, res, next) => {
    try {
      const result = await agentService.configureEndpoint({
        ownerUserId: req.authUser.id,
        agentId: req.params.id,
        endpoint: req.body,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/pause', async (req, res, next) => {
    try {
      const result = await agentService.pauseAgent({
        ownerUserId: req.authUser.id,
        agentId: req.params.id,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createAgentRoutes;
