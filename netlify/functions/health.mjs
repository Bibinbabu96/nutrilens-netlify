import {runtime} from '../../lib/runtime.mjs';
export default request=>runtime().health(request);
export const config={path:'/health'};
