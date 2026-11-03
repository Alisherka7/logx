/** An expected, user-facing failure. `fix` tells the user what to do next. */
export class LogxError extends Error {
  readonly fix: string | undefined;

  constructor(message: string, fix?: string) {
    super(message);
    this.name = "LogxError";
    this.fix = fix;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
