import {runtime} from '../../lib/runtime.mjs';
export default request=>runtime().status(request);
export const config={path:'/analysis-status'};
