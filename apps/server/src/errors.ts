/**
 * HTTP error type and the error envelope middleware.
 *
 * Every error leaves the server as `{ error: { code, message, details? } }`:
 *   400 validation_error / invalid_json     403 read_only     404 not_found
 *   409 conflict                            422 modelica_error (details.diagnostics)
 *   500 internal_error
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Diagnostic } from '@impact/core';
import type { ApiError } from '@impact/protocol';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'validation_error', message, details);
export const notFound = (message: string, details?: unknown) => new HttpError(404, 'not_found', message, details);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const readOnly = (message: string) => new HttpError(403, 'read_only', message);
export const unprocessable = (message: string, diagnostics: Diagnostic[]) => new HttpError(422, 'modelica_error', message, { diagnostics });

function isModelicaError(err: unknown): err is Error & { diagnostics: Diagnostic[] } {
  return err instanceof Error && err.name === 'ModelicaError' && Array.isArray((err as { diagnostics?: unknown }).diagnostics);
}

/** Converts any thrown value into the diagnostics list used in 422 responses. */
export function diagnosticsOf(err: unknown): Diagnostic[] {
  if (isModelicaError(err)) return err.diagnostics;
  return [{ severity: 'error', message: err instanceof Error ? err.message : String(err) }];
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = { error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } };
  res.status(404).json(body);
};

export function errorMiddleware(options: { log?: (line: string) => void } = {}): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'Internal server error';
    let details: unknown;

    if (err instanceof HttpError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (isModelicaError(err)) {
      status = 422;
      code = 'modelica_error';
      message = err.message;
      details = { diagnostics: err.diagnostics };
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      status = 400;
      code = 'invalid_json';
      message = 'Request body is not valid JSON';
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'Request body too large';
    } else if (err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number' && (err as { status: number }).status >= 400 && (err as { status: number }).status < 500) {
      status = (err as { status: number }).status;
      code = 'bad_request';
      message = err instanceof Error ? err.message : String(err);
    } else {
      message = err instanceof Error ? err.message : String(err);
      options.log?.(`error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    res.status(status).json(body);
  };
}
