import {runtime} from '../../lib/runtime.mjs';
export default ()=>runtime().cleanup();
export const config={schedule:'0 * * * *'};
