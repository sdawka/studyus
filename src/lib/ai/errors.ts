export type AiBudgetExceededCode = 'daily_limit' | 'concurrent_limit';

export class AiBudgetExceededError extends Error {
  readonly code: AiBudgetExceededCode;
  readonly status: 409 | 429;

  constructor(code: AiBudgetExceededCode) {
    super(code === 'daily_limit' ? 'Daily AI call limit reached' : 'An AI provider call is already in progress');
    this.name = 'AiBudgetExceededError';
    this.code = code;
    this.status = code === 'daily_limit' ? 429 : 409;
  }
}
