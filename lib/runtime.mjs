import {getStore} from '@netlify/blobs';
import {handlers} from './jobs.mjs';
export function runtime(context){return handlers({store:getStore({name:'nutrilens-jobs',consistency:'strong'}),env:{...process.env,URL:context?.site?.url??process.env.URL}});}
