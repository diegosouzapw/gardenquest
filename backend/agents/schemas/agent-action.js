const ALLOWED_ACTIONS = new Set(['wait', 'move_to', 'drink_water', 'pick_fruit', 'eat_fruit']);

function sanitizeSpeech(value, maxLength = 140) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, Math.max(0, maxLength));
}

function normalizeLegacyDecision(decision, { speechMaxChars = 140 } = {}) {
  if (!decision || typeof decision !== 'object') {
    return null;
  }

  const action = typeof decision.action === 'string' ? decision.action.trim() : '';
  if (!ALLOWED_ACTIONS.has(action)) {
    return null;
  }

  const targetId = typeof decision.targetId === 'string'
    ? decision.targetId.trim()
    : typeof decision.target_id === 'string'
      ? decision.target_id.trim()
      : null;

  const speech = sanitizeSpeech(decision.speech, speechMaxChars);

  return {
    action,
    targetId: targetId || null,
    speech,
  };
}

function validateAgentDecision(decision, { speechMaxChars = 140 } = {}) {
  const normalized = normalizeLegacyDecision(decision, { speechMaxChars });
  if (!normalized) {
    return false;
  }

  if (normalized.speech && normalized.speech.length > speechMaxChars) {
    return false;
  }

  return true;
}

module.exports = {
  ALLOWED_ACTIONS,
  sanitizeSpeech,
  normalizeLegacyDecision,
  validateAgentDecision,
};
