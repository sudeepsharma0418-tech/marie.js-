export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'forbidden', message);
/** Also used when a record exists but belongs to another hotel, so ids cannot be probed. */
export const notFound = (what = 'Record') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, 'business_rule', message, details);
