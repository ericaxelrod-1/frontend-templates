export class RlsSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RlsSecurityViolationError';
  }
}
