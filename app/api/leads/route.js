import handler from '../../../server/leads.js';
import { adapt } from '../../../server/_adapter.js';
export const maxDuration = 60;
const h = adapt(handler);
export { h as GET };
export { h as PATCH };
