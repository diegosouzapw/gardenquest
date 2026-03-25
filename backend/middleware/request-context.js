const { randomUUID } = require('crypto');

function normalizeCorrelationId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^[a-zA-Z0-9._:-]{8,128}$/.test(trimmed)
    ? trimmed
    : null;
}

function requestContext(req, res, next) {
  const correlationId = normalizeCorrelationId(req.headers['x-correlation-id']) || randomUUID();

  req.correlationId = correlationId;
  req.requestContext = {
    correlationId,
    startedAtMs: Date.now(),
  };

  res.locals.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  next();
}

module.exports = {
  requestContext,
  normalizeCorrelationId,
};
