export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (m = 'Introuvable.') => new AppError(404, 'not_found', m);
export const forbidden = (m = 'Accès refusé.') => new AppError(403, 'forbidden', m);
export const conflict = (code: string, m: string, details?: unknown) => new AppError(409, code, m, details);
export const bad = (code: string, m: string, details?: unknown) => new AppError(400, code, m, details);
