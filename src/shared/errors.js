export class RefactorPilotError extends Error {
  constructor(message, code = 'REFACTOR_PILOT_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends RefactorPilotError {
  constructor(message, details = {}) {
    super(message, 'REFACTOR_PILOT_VALIDATION_ERROR', details);
  }
}

export class SerializationError extends RefactorPilotError {
  constructor(message, details = {}) {
    super(message, 'REFACTOR_PILOT_SERIALIZATION_ERROR', details);
  }
}
