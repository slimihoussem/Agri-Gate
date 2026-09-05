import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodTypeAny } from "zod";
import { ValidationIssue, ValidationError } from "./errorHandler";

type Source = "body" | "query" | "params";

interface Check {
  source: Source;
  schema: ZodTypeAny;
}

/**
 * Validates req.body / req.query / req.params against zod schemas.
 * Parsed (coerced + defaulted) values are written back onto the request,
 * so handlers always receive clean, typed inputs.
 * Fails with 400 + field-level validation details.
 */
export const validateRequest =
  (...checks: Check[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const issues: ValidationIssue[] = [];
    const parsedBySource = new Map<Source, unknown>();

    for (const { source, schema } of checks) {
      try {
        parsedBySource.set(source, schema.parse(req[source]));
      } catch (err) {
        if (err instanceof ZodError) {
          for (const issue of err.errors) {
            issues.push({
              path: [source, ...issue.path.map(String)].join("."),
              message: issue.message,
            });
          }
        } else {
          next(err);
          return;
        }
      }
    }

    if (issues.length > 0) {
      next(
        new ValidationError(
          `Invalid request: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`,
          issues
        )
      );
      return;
    }

    for (const [source, parsed] of Array.from(parsedBySource.entries())) {
      Object.defineProperty(req, source, {
        value: parsed,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
