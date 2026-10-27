export class AppError extends Error {
  constructor(status, message, code = 'invalid_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function insist(condition, message, status = 400) {
  if (!condition) throw new AppError(status, message);
}
