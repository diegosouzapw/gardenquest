const config = require('../../config');

function normalizeSpeech(value, maxChars) {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  return compact.slice(0, Math.max(1, Math.trunc(maxChars || config.AGENT_SPEECH_MAX_CHARS || 96)));
}

function buildFlag(code, severity, detail) {
  return { code, severity, detail: detail ? String(detail).slice(0, 180) : null };
}

class AgentModerationService {
  constructor({ logger = console } = {}) { this.logger = logger; }

  moderateDecision({ agent = null, decision = {}, policy = {} } = {}) {
    const speechMaxChars = Math.max(1, Math.trunc(policy?.speechMaxChars || config.AGENT_SPEECH_MAX_CHARS || 96));
    const speech = normalizeSpeech(decision?.speech, speechMaxChars);
    const flags = [];
    let moderatedSpeech = speech;

    if (!config.AGENT_SPEECH_MODERATION_ENABLED) {
      return { decision: { ...decision, speech: moderatedSpeech }, moderation: { changed: false, blocked: false, suspicious: false, flags } };
    }

    if (moderatedSpeech && !config.AGENT_SPEECH_ALLOW_URLS) {
      if (/(https?:\/\/|www\.|discord\.gg|t\.me\/|@\w+\.\w+)/i.test(moderatedSpeech)) {
        flags.push(buildFlag('external_link', 'high', 'speech contains URL or external contact pattern'));
        moderatedSpeech = null;
      }
    }

    if (moderatedSpeech) {
      const blocklist = Array.isArray(config.AGENT_SPEECH_BLOCKLIST) ? config.AGENT_SPEECH_BLOCKLIST : [];
      for (const term of blocklist) {
        const normalizedTerm = String(term || '').trim();
        if (!normalizedTerm) continue;
        if (moderatedSpeech.toLowerCase().includes(normalizedTerm.toLowerCase())) {
          flags.push(buildFlag('blocked_term', 'medium', normalizedTerm));
          moderatedSpeech = moderatedSpeech.replace(new RegExp(normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '[redacted]');
        }
      }
    }

    if (moderatedSpeech && /(.)\\1{7,}/.test(moderatedSpeech)) {
      flags.push(buildFlag('repetition_spam', 'low', 'speech has repeated characters'));
      moderatedSpeech = moderatedSpeech.replace(/(.)\\1{3,}/g, '$1$1$1');
    }

    const changed = moderatedSpeech !== speech;
    const blocked = speech && !moderatedSpeech;
    const suspicious = flags.some((f) => f.severity === 'high');
    if (changed && blocked && agent?.id) this.logger.warn(`Agent moderation blocked speech for ${agent.id}`);

    return { decision: { ...decision, speech: moderatedSpeech }, moderation: { changed, blocked, suspicious, flags } };
  }
}

module.exports = { AgentModerationService };
