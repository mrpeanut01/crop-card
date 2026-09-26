import { createSendLimiter } from './sendLimiter';

const HOUR = 60 * 60_000;

/** "Send me a test email": 3 an hour and 10 a day per person, so a loop
 *  cannot burn the sending allowance or the domain's reputation. */
export const testEmailLimiter = createSendLimiter([
  { ms: HOUR, max: 3 },
  { ms: 24 * HOUR, max: 10 }
]);
