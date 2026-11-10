import type { Config, Context } from '@netlify/functions';
import { handle } from '../../server/netlify.js';

export default async (req: Request, context: Context) => handle(req, context.ip);

export const config: Config = { path: '/api/*' };
