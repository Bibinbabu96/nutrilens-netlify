import {getStore} from '@netlify/blobs';
import {handlers} from './jobs.mjs';

// Read each variable at invocation time, using Netlify's runtime API first.
// Do not enumerate/copy process.env: platform-backed values may be dynamic.
export function readEnvironment(context, platform=globalThis.Netlify, fallback=process.env){
  const read=name=>{
    const value=platform?.env?.get(name)??fallback[name];
    return typeof value==='string'?value.trim():undefined;
  };
  return {
    GEMINI_API_KEY:read('GEMINI_API_KEY'),
    APP_ACCESS_TOKEN:read('APP_ACCESS_TOKEN'),
    GEMINI_MODEL:read('GEMINI_MODEL'),
    URL:context?.site?.url??read('URL')
  };
}
export function runtime(context){
  return handlers({
    store:getStore({name:'nutrilens-jobs',consistency:'strong'}),
    env:readEnvironment(context)
  });
}
