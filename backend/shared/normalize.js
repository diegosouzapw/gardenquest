function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!Number.isFinite(maxLength)) {
    return trimmed;
  }

  return trimmed.slice(0, Math.max(0, Math.trunc(maxLength)));
}

function normalizeEmail(value, maxLength = 320) {
  const normalized = normalizeText(value, maxLength);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeInteger(value, fallback, min = 1, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

module.exports = {
  normalizeEmail,
  normalizeInteger,
  normalizeText,
};
