export type AiBudgetExceededCode = 'daily_limit' | 'concurrent_limit' | 'global_limit';

const MESSAGES: Record<AiBudgetExceededCode, string> = {
  daily_limit: 'Daily AI call limit reached',
  concurrent_limit: 'An AI provider call is already in progress',
  global_limit: 'The AI tutor is at capacity for today. Please try again tomorrow.',
};

export class AiBudgetExceededError extends Error {
  readonly code: AiBudgetExceededCode;
  readonly status: 409 | 429;

  constructor(code: AiBudgetExceededCode) {
    super(MESSAGES[code]);
    this.name = 'AiBudgetExceededError';
    this.code = code;
    this.status = code === 'concurrent_limit' ? 409 : 429;
  }
}
