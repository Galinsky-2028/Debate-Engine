/** Kept free of server-only/Next imports (and of TS-only syntax) so transaction cores run under DB integration tests. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
