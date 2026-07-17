import handler from '../../../server/vapi-webhook.js';
import { adapt } from '../../../server/_adapter.js';
export const maxDuration = 60;
const h = adapt(handler);
export { h as POST };
