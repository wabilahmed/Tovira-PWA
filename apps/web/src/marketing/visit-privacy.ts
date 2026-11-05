/** [P63-7] The privacy page's only script: its page view (it loads nothing else, and never the landing's redirect). */
import { sendVisit } from './visit.js';

sendVisit('privacy');
