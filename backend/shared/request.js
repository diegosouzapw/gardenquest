const { normalizeText } = require('./normalize');

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor || req.socket?.remoteAddress || '';
  return String(rawIp).split(',')[0].trim();
}

function getRequestUserAgent(req, maxLength = 512) {
  return normalizeText(req.headers?.['user-agent'], maxLength) || '';
}

module.exports = {
  getRequestIp,
  getRequestUserAgent,
};
