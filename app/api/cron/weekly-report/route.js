import handler from '../../../../server/cron/weekly-report.js';
import { adapt } from '../../../../server/_adapter.js';
export const maxDuration = 60;
const h = adapt(handler);
export { h as GET };
