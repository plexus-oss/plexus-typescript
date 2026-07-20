export class PlexusError extends Error {
  constructor(
    message: string,
    /** HTTP status when the error came from the API. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PlexusError";
  }
}

/** 401/403 — bad key or missing write scope. Configuration, not weather. */
export class AuthenticationError extends PlexusError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "AuthenticationError";
  }
}
