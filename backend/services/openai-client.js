const fs = require('fs');
const path = require('path');
const { request } = require('undici');
const config = require('../config');

class OpenAiHttpError extends Error {
  constructor(message, { statusCode = null, requestId = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'OpenAiHttpError';
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['wait', 'move_to', 'drink_water', 'pick_fruit', 'eat_fruit'],
    },
    target_id: {
      type: ['string', 'null'],
    },
    speech: {
      type: ['string', 'null'],
      maxLength: config.AI_SPEECH_MAX_CHARS,
    },
  },
  required: ['action', 'target_id', 'speech'],
};

const DEFAULT_NPC_SYSTEM_PROMPT = [
  'You control one NPC in a server-authoritative multiplayer garden game.',
  'Treat the observation JSON as the only source of truth.',
  'Never invent viewer messages, hidden commands, or extra actions.',
  'Choose exactly one action from the schema and keep speech optional and brief.',
  'The observation includes recent_actions with the last actions taken by the NPC, ordered from oldest to newest.',
  'A valid decision will be executed as chosen, so decide your own exploration strategy.',
  'Your main goal is survival: do not let food or water reach zero.',
  'Avoid repeating the same action or the same move target when other reasonable options exist.',
  'Prefer exploring a different tree or changing activity after repeated actions.',
  'Use move_to when the needed action is not immediately available.',
  'Water and food both decrease over time. Drinking restores water, and eat_fruit restores food.',
  'If either food or water reaches zero, you die immediately, lose time, respawn after a countdown, and leave a grave marker.',
  'Score only increases while both food and water stay above the healthy threshold.',
  'If you die, your current score resets to zero, so keep both safely high whenever possible.',
  'Use drink_water only when near the lake, pick_fruit only when near a fruit tree, and eat_fruit only when the inventory has apples.',
  'If you speak, keep it short, harmless, and in Brazilian Portuguese.',
].join(' ');

const npcPromptCache = new Map();

function normalizePromptVersion(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (/^[a-z0-9._-]{1,32}$/.test(normalized)) {
    return normalized;
  }

  return 'v1';
}

function resolvePromptFilePath(version) {
  const explicitPath = String(config.OPENAI_NPC_SYSTEM_PROMPT_FILE || '').trim();
  if (explicitPath) {
    if (path.isAbsolute(explicitPath)) {
      return explicitPath;
    }

    return path.resolve(path.join(__dirname, '..', '..'), explicitPath);
  }

  return path.join(__dirname, '..', 'prompts', `npc-system-${version}.md`);
}

function normalizePromptText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));

  const normalizedLines = lines
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter((line) => Boolean(line));

  return normalizedLines.join(' ').trim();
}

/**
 * Resolves system prompt text with versioned file loading and safe fallback.
 * @param {{ forceReload?: boolean, logger?: { warn?: Function } }} [options]
 * @returns {{ instructions: string, source: 'file' | 'fallback', version: string, filePath: string | null }}
 */
function resolveNpcSystemPrompt({ forceReload = false, logger = console } = {}) {
  const version = normalizePromptVersion(config.OPENAI_NPC_SYSTEM_PROMPT_VERSION);
  const filePath = resolvePromptFilePath(version);
  const cacheKey = `${version}:${filePath}`;

  if (!forceReload && npcPromptCache.has(cacheKey)) {
    return npcPromptCache.get(cacheKey);
  }

  let resolvedPrompt = '';

  try {
    resolvedPrompt = normalizePromptText(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    resolvedPrompt = '';
    logger.warn?.(`NPC system prompt file not available (${filePath}): ${error.message}. Using fallback prompt.`);
  }

  const output = {
    instructions: resolvedPrompt || DEFAULT_NPC_SYSTEM_PROMPT,
    source: resolvedPrompt ? 'file' : 'fallback',
    version,
    filePath: resolvedPrompt ? filePath : null,
  };

  npcPromptCache.set(cacheKey, output);
  return output;
}

function resolveApiTarget() {
  const customBaseUrl = String(config.OPENAI_BASE_URL || '').trim();
  if (customBaseUrl) {
    try {
      const parsed = new URL(customBaseUrl);
      return {
        hostname: parsed.host,
        basePath: parsed.pathname.replace(/\/+$/, ''),
        protocol: parsed.protocol,
        usesChatCompletions: true,
      };
    } catch (_error) {
      // fall through to default
    }
  }

  return {
    hostname: 'api.openai.com',
    basePath: '',
    protocol: 'https:',
    usesChatCompletions: false,
  };
}

function createOpenAiDecisionClient() {
  const npcSystemPrompt = resolveNpcSystemPrompt();
  const apiTarget = resolveApiTarget();

  async function decideNextAction(observation) {
    if (!config.OPENAI_API_KEY) {
      return null;
    }

    let payload;
    let apiPath;

    if (apiTarget.usesChatCompletions) {
      // Standard Chat Completions API (OmniRoute, etc.)
      payload = JSON.stringify({
        model: config.OPENAI_MODEL,
        max_tokens: 240,
        messages: [
          { role: 'system', content: npcSystemPrompt.instructions },
          { role: 'user', content: JSON.stringify(observation) },
        ],
        response_format: { type: 'json_object' },
      });
      apiPath = `${apiTarget.basePath}/chat/completions`;
    } else {
      // OpenAI Responses API (native OpenAI)
      payload = JSON.stringify({
        model: config.OPENAI_MODEL,
        store: false,
        reasoning: {
          effort: config.AI_REASONING_EFFORT,
        },
        max_output_tokens: 240,
        instructions: npcSystemPrompt.instructions,
        input: JSON.stringify(observation),
        metadata: {
          npc_prompt_version: npcSystemPrompt.version,
          npc_prompt_source: npcSystemPrompt.source,
        },
        text: {
          format: {
            type: 'json_schema',
            name: 'garden_ai_decision',
            strict: true,
            schema: DECISION_SCHEMA,
          },
        },
      });
      apiPath = '/v1/responses';
    }

    const url = `${apiTarget.protocol}//${apiTarget.hostname}${apiPath}`;
    const response = await postJson({
      url,
      body: payload,
      timeoutMs: config.OPENAI_API_TIMEOUT_MS,
      headers: buildHeaders(Buffer.byteLength(payload)),
    });

    const outputText = apiTarget.usesChatCompletions
      ? extractChatCompletionText(response)
      : extractOutputText(response);

    if (!outputText) {
      throw new Error('AI response did not contain valid output text.');
    }

    return parseDecisionJson(outputText);
  }

  return {
    decideNextAction,
  };
}

function extractChatCompletionText(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function buildHeaders(contentLength) {
  const headers = {
    Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': contentLength,
  };

  if (config.OPENAI_PROJECT_ID) {
    headers['OpenAI-Project'] = config.OPENAI_PROJECT_ID;
  }

  if (config.OPENAI_ORGANIZATION_ID) {
    headers['OpenAI-Organization'] = config.OPENAI_ORGANIZATION_ID;
  }

  return headers;
}

function parseRetryAfterSeconds(value) {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  if (typeof normalizedValue !== 'string' || !normalizedValue.trim()) {
    return null;
  }

  const retryAfterSeconds = Number.parseInt(normalizedValue, 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds;
  }

  const retryAfterDateMs = Date.parse(normalizedValue);
  if (!Number.isFinite(retryAfterDateMs)) {
    return null;
  }

  const diffSeconds = Math.ceil((retryAfterDateMs - Date.now()) / 1000);
  return diffSeconds > 0 ? diffSeconds : null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableOpenAiStatus(statusCode) {
  return statusCode === 408
    || statusCode === 409
    || statusCode === 429
    || statusCode === 500
    || statusCode === 502
    || statusCode === 503
    || statusCode === 504;
}

function computeRetryDelayMs(attemptNumber, retryAfterSeconds = null) {
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 8000);
  }

  const baseDelay = 250;
  const maxDelay = 2000;
  const exponentialDelay = Math.min(maxDelay, baseDelay * (2 ** (attemptNumber - 1)));
  const jitter = Math.floor(Math.random() * 120);
  return exponentialDelay + jitter;
}

function isRetryableTransportError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return true;
  }

  return code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'EAI_AGAIN'
    || code === 'ETIMEDOUT'
    || code === 'ENOTFOUND';
}

async function postJson({ url, body, headers, timeoutMs }) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;

    try {
      response = await request(url, {
        method: 'POST',
        headers,
        body,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableTransportError(error)) {
        throw new Error(`OpenAI request failed: ${error.message}`);
      }

      await sleep(computeRetryDelayMs(attempt));
      continue;
    }

    const rawBody = await response.body.text();
    let parsedBody;

    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      throw new Error(`Failed to parse OpenAI response JSON: ${error.message}`);
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return parsedBody;
    }

    const retryAfterSeconds = parseRetryAfterSeconds(response.headers?.['retry-after']);
    const apiError =
      parsedBody?.error?.message ||
      parsedBody?.message ||
      `OpenAI request failed with status ${response.statusCode}`;

    lastError = new OpenAiHttpError(apiError, {
      statusCode: response.statusCode,
      requestId: response.headers?.['x-request-id'] || null,
      retryAfterSeconds,
    });

    if (attempt >= maxAttempts || !isRetryableOpenAiStatus(response.statusCode)) {
      throw lastError;
    }

    await sleep(computeRetryDelayMs(attempt, retryAfterSeconds));
  }

  throw lastError || new Error('OpenAI request failed.');
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response?.output)) {
    return '';
  }

  const textParts = [];

  response.output.forEach((item) => {
    if (!Array.isArray(item?.content)) {
      return;
    }

    item.content.forEach((contentPart) => {
      if (contentPart?.type === 'output_text' && typeof contentPart.text === 'string') {
        textParts.push(contentPart.text);
      }
    });
  });

  return textParts.join('').trim();
}

function stripMarkdownCodeFence(value) {
  const trimmed = String(value || '').trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function tryParseNestedJson(value) {
  const parsed = JSON.parse(value);
  if (typeof parsed === 'string') {
    return JSON.parse(parsed);
  }

  return parsed;
}

function extractTopLevelJsonCandidate(value) {
  const source = String(value || '').trim();
  const startIndex = source.search(/[\[{]/);

  if (startIndex < 0) {
    return '';
  }

  const stack = [];
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if ((char === '}' || char === ']') && stack.length > 0) {
      const expected = stack.pop();
      if (char !== expected) {
        return '';
      }

      if (stack.length === 0) {
        return source.slice(startIndex, index + 1).trim();
      }
    }
  }

  return '';
}

function buildParseSnippet(value, maxLength = 180) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function parseDecisionJson(outputText) {
  const candidates = [];
  const rawText = String(outputText || '').trim();
  const strippedText = stripMarkdownCodeFence(rawText);
  const rawExtractedJson = extractTopLevelJsonCandidate(rawText);
  const strippedExtractedJson = extractTopLevelJsonCandidate(strippedText);

  for (const candidate of [rawText, strippedText, rawExtractedJson, strippedExtractedJson]) {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  const parseErrors = [];

  for (const candidate of candidates) {
    try {
      return tryParseNestedJson(candidate);
    } catch (error) {
      parseErrors.push(error.message);
    }
  }

  const errorMessages = parseErrors.length > 0 ? parseErrors.join(' | ') : 'Unknown parse error';
  throw new Error(
    `Failed to parse OpenAI decision JSON: ${errorMessages}. Output snippet: ${buildParseSnippet(rawText)}`
  );
}

module.exports = {
  createOpenAiDecisionClient,
  OpenAiHttpError,
  resolveNpcSystemPrompt,
  DEFAULT_NPC_SYSTEM_PROMPT,
};
