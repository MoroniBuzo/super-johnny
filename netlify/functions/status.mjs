// Estado público: ¿se puede pedir en línea ahora? y tiempo de espera.
import { json, handleError, publicStatus } from '../lib/core.mjs';

export default async () => {
  try { return json(await publicStatus()); } catch (e) { return handleError(e); }
};
export const config = { path: '/api/status' };
