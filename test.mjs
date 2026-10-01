import test from 'node:test';
import assert from 'node:assert/strict';
import {handlers} from './lib/jobs.mjs';
function setup(){
 let clock=10000000000,seq=0,trigger,paid=0;
 const map=new Map();
 const store={
  async setJSON(key,data,options={}){
   const old=map.get(key);if(options.onlyIfNew&&old)return{modified:false};if(options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return{modified:false};
   const etag=String(++seq);map.set(key,{data:structuredClone(data),etag});return{modified:true,etag};
  },async get(key){return structuredClone(map.get(key)?.data??null);},async getWithMetadata(key){return structuredClone(map.get(key)??null);},async delete(key){map.delete(key);},async list(){return{blobs:[...map.keys()].map(key=>({key}))};}
 };
 const env={GEMINI_API_KEY:'test-only',APP_ACCESS_TOKEN:'a'.repeat(64),URL:'https://example.netlify.app'};
 const h=handlers({store,env,now:()=>clock,fetchImpl:async(url,options)=>{trigger={url,options};return new Response(null,{status:202});},analyseImpl:async(input,options)=>{assert.equal(options.apiKey,env.GEMINI_API_KEY);assert.equal(options.model,'gemini-flash-lite-latest');paid++;return{testReport:true};}});
 const auth={authorization:'Bearer '+env.APP_ACCESS_TOKEN,'content-type':'application/json'};
 const input={goal:'Fat loss',compare:false,products:[{id:'p0',text:'Ingredients: oats. Nutrition per 100 g: 300 kcal, protein 10 g.'}]};
 const start=()=>h.start(new Request(env.URL+'/analyse',{method:'POST',headers:auth,body:JSON.stringify(input)}));
 const worker=()=>h.worker(new Request(trigger.url,{method:'POST',headers:trigger.options.headers,body:trigger.options.body}));
 const status=(id,method='GET')=>h.status(new Request(env.URL+'/analysis-status?id='+id,{method,headers:auth}));
 return{h,map,env,store,start,worker,status,advance:()=>{clock+=7200000;},get paid(){return paid;}};
}
test('job start, pending, worker completion and authenticated deletion',async()=>{
 const s=setup(),response=await s.start();assert.equal(response.status,202);const{id:unused,jobId}=await response.json();
 assert.equal((await(await s.status(jobId)).json()).state,'queued');
 await s.worker();const result=await(await s.status(jobId)).json();assert.equal(result.state,'completed');assert.deepEqual(result.report,{testReport:true});
 assert.equal(s.map.get('job/'+jobId).data.input,undefined);
 assert.equal((await s.status(jobId,'DELETE')).status,200);assert.equal((await s.status(jobId)).status,404);
});
test('duplicate worker invocations only call provider once',async()=>{
 const s=setup();await s.start();await Promise.all([s.worker(),s.worker()]);assert.equal(s.paid,1);
});
test('unauthenticated requests and worker invocations do not analyse',async()=>{
 const s=setup();assert.equal((await s.h.start(new Request(s.env.URL+'/analyse',{method:'POST'}))).status,401);
 await s.h.worker(new Request(s.env.URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'00000000-0000-0000-0000-000000000000'})}));assert.equal(s.paid,0);
});
test('distributed hourly quota caps accepted jobs at 30',async()=>{
 const s=setup();for(let i=0;i<30;i++)assert.equal((await s.start()).status,202);assert.equal((await s.start()).status,429);
});
test('expired reports are inaccessible and cleanup removes expired quota entries',async()=>{
 const s=setup(),{jobId}=await(await s.start()).json();s.advance();assert.equal((await s.status(jobId)).status,410);await s.h.cleanup();assert.equal(s.map.size,0);
});
test('configuration and invalid-job errors are explicit',async()=>{
 const s=setup();assert.equal((await s.status('invalid')).status,400);delete s.env.GEMINI_API_KEY;assert.equal((await s.h.health(new Request(s.env.URL))).status,503);
});
test('failed provider marks job failed and removes input',async()=>{
 const s=setup(),h=handlers({store:s.store,env:s.env,now:()=>10000000000,analyseImpl:async()=>{throw new Error('private secret detail');}});
 const response=await s.start(),{jobId}=await response.json();
 const {createHmac}=await import('node:crypto');const signature=createHmac('sha256',s.env.APP_ACCESS_TOKEN).update('nutrilens-job:'+jobId).digest('hex');
 await h.worker(new Request(s.env.URL,{method:'POST',headers:{'content-type':'application/json','x-job-signature':signature},body:JSON.stringify({id:jobId})}));
 const result=await(await s.status(jobId)).json();assert.equal(result.state,'failed');assert.ok(!result.error.includes('private secret'));assert.equal(s.map.get('job/'+jobId).data.input,undefined);
});
test('runtime reads Netlify values directly even when process env has no enumerable keys',async()=>{
 const {readEnvironment}=await import('./lib/runtime.mjs');
 const values={GEMINI_API_KEY:' test-key ',APP_ACCESS_TOKEN:'x'.repeat(64),GEMINI_MODEL:'test-model'};
 const result=readEnvironment({site:{url:'https://production.example'}},{env:{get:key=>values[key]}},{});
 assert.equal(result.GEMINI_API_KEY,'test-key');assert.equal(result.APP_ACCESS_TOKEN.length,64);assert.equal(result.URL,'https://production.example');
});
test('runtime fallback supports non-enumerable variables without exposing them',async()=>{
 const {readEnvironment}=await import('./lib/runtime.mjs');const env={};
 Object.defineProperty(env,'GEMINI_API_KEY',{value:'hidden-test-key',enumerable:false});
 assert.deepEqual({...env},{});assert.equal(readEnvironment(undefined,undefined,env).GEMINI_API_KEY,'hidden-test-key');
});
test('configuration errors distinguish missing key, missing token and short token',async()=>{
 const s=setup();s.env.APP_ACCESS_TOKEN='short';
 assert.match((await(await s.h.health(new Request(s.env.URL))).json()).error,/shorter than 32/);
 delete s.env.APP_ACCESS_TOKEN;
 assert.match((await(await s.h.health(new Request(s.env.URL))).json()).error,/APP_ACCESS_TOKEN is unavailable/);
 delete s.env.GEMINI_API_KEY;
 assert.match((await(await s.h.health(new Request(s.env.URL))).json()).error,/GEMINI_API_KEY is unavailable/);
});

test('health identifies Gemini without making an API call',async()=>{
 const s=setup();const result=await(await s.h.health(new Request(s.env.URL))).json();
 assert.equal(result.provider,'gemini');assert.equal(result.model,'gemini-flash-lite-latest');assert.equal(s.paid,0);
});
