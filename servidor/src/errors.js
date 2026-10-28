'use strict';

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// A part of the system is not ready yet (script not run, Python not restarted). The message says what to do.
class NotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotReadyError';
  }
}

module.exports = { ValidationError, NotFoundError, ConflictError, ForbiddenError, NotReadyError };
