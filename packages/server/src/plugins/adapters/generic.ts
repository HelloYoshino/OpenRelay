import { isPlainObject } from '../../util/json.js';
import { AdapterError, type IngestAdapter } from '../types.js';
import type { EventInput } from '../../types.js';

export const genericAdapter: IngestAdapter = {
  name: 'generic',
  description: 'OpenRelay-Format: ein Ereignis, eine Liste oder { "events": [...] }.',
  parse({ body }) {
    if (Array.isArray(body)) return body as EventInput[];
    if (isPlainObject(body) && Array.isArray(body.events)) return body.events as EventInput[];
    if (isPlainObject(body)) return [body as unknown as EventInput];
    throw new AdapterError('Erwartet JSON-Objekt oder -Liste');
  },
};
