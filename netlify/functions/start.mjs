import {runtime} from '../../lib/runtime.mjs';
export default (request,context)=>runtime(context).start(request);
export const config={path:'/analyse'};
