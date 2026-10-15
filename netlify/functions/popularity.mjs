import { getDatabase } from '@netlify/database';
import { createHandler } from '../../server/handler.mjs';
import { tipIds } from '../../server/tip-ids.mjs';

export default createHandler(() => getDatabase(), new Set(tipIds));
export const config = {
  path: '/api/popularity',
  rateLimit: { action: 'rate_limit', aggregateBy: 'ip', windowSize: 60, windowLimit: 120 }
};
