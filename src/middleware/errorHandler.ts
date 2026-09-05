import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Throwable error carrying an HTTP status code — safe for services to use (no express types). */
export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }

  static notFound(message = "Resource not found"): HttpError {
    return new HttpError(404, message);
  }
}

/** 400 with structured field-level details, produced by validateRequest. */
export class ValidationError extends HttpError {
  constructor(message: string, public readonly details: ValidationIssue[]) {
    super(400, message);
    this.name = "ValidationError";
  }
}

/** Wraps async route handlers so rejections reach errorHandler (Express 4 does not catch promises). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  // body-parser JSON syntax errors
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON in request body" });
    return;
  }
  // PostgreSQL unique constraint violation
  if ((err as { code?: string }).code === "23505") {
    res.status(409).json({ error: "Resource already exists (unique constraint violation)" });
    return;
  }
  console.error("[agrigate-api] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
};
