import type { ValidationIssue } from './validation.js';

export class PersonaQAError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'PersonaQAError';
  }

  describe(): string {
    if (this.issues.length === 0) {
      return this.message;
    }

    return [this.message, ...this.issues.map((issue) => `  ${issue.path}: ${issue.message}`)].join(
      '\n',
    );
  }
}
