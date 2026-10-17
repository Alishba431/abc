class AppError extends Error {
  constructor(status, code, message, details = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const err = (status, code, message, details) => new AppError(status, code, message, details);
const validation = (fields, message = 'Request validation failed.') =>
  new AppError(400, 'VALIDATION_ERROR', message, { fields });

function errorBody(e) {
  return { error: { code: e.code, message: e.message, details: e.details || {} } };
}

module.exports = { AppError, err, validation, errorBody };
