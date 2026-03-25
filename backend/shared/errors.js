const ERROR_CATALOG = Object.freeze({
  invalid_session: Object.freeze({ statusCode: 401, publicMessage: 'Invalid, expired, or revoked session' }),
  forbidden: Object.freeze({ statusCode: 403, publicMessage: 'Forbidden' }),
  validation_failed: Object.freeze({ statusCode: 400, publicMessage: 'Validation failed' }),
  not_found: Object.freeze({ statusCode: 404, publicMessage: 'Not found' }),
  internal_error: Object.freeze({ statusCode: 500, publicMessage: 'Internal server error' }),
});

class AppError extends Error {
  constructor(code = 'internal_error', {
    statusCode,
    publicMessage,
    details = null,
    cause = null,
  } = {}) {
    const catalogEntry = ERROR_CATALOG[code] || ERROR_CATALOG.internal_error;
    const effectivePublicMessage = typeof publicMessage === 'string' && publicMessage.trim()
      ? publicMessage.trim()
      : catalogEntry.publicMessage;

    super(effectivePublicMessage);
    this.name = 'AppError';
    this.code = ERROR_CATALOG[code] ? code : 'internal_error';
    this.statusCode = Number.isInteger(statusCode) ? statusCode : catalogEntry.statusCode;
    this.publicMessage = effectivePublicMessage;
    this.details = details;
    this.cause = cause;
  }
}

function createAppError(code, options = {}) {
  return new AppError(code, options);
}

function normalizeToAppError(error, { fallbackCode = 'internal_error' } = {}) {
  if (error instanceof AppError) {
    return error;
  }

  const fallback = ERROR_CATALOG[fallbackCode] || ERROR_CATALOG.internal_error;
  const rawStatus = Number(error?.statusCode || error?.status || fallback.statusCode);
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : fallback.statusCode;
  const hasPublicMessage = typeof error?.publicMessage === 'string' && error.publicMessage.trim().length > 0;

  return new AppError(fallbackCode, {
    statusCode,
    publicMessage: hasPublicMessage ? error.publicMessage : fallback.publicMessage,
    details: error?.details || null,
    cause: error,
  });
}

function buildErrorResponse(error, {
  fallbackCode = 'internal_error',
  correlationId = null,
} = {}) {
  const appError = normalizeToAppError(error, { fallbackCode });

  return {
    statusCode: appError.statusCode,
    payload: {
      error: appError.publicMessage,
      code: appError.code,
      errorId: correlationId,
      correlationId,
    },
    appError,
  };
}

module.exports = {
  ERROR_CATALOG,
  AppError,
  createAppError,
  normalizeToAppError,
  buildErrorResponse,
};
