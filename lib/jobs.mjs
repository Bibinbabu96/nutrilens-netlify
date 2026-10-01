import {randomUUID,createHash,timingSafeEqual,createHmac} from 'node:crypto';
import {AppError,validateInput,analyse} from './analysis.mjs';
const digest=x=>createHash('sha256').update(x).digest();
const idOK=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const lifetime=3600000;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function handlers({store,env,fetchImpl=fetch,analyseImpl=analyse,now=Date.now,uuid=randomUUID}) {
  const ready=()=>{
    if(!env.OPENAI_API_KEY)throw new AppError(503,'OPENAI_API_KEY is unavailable to this deployed function. Check its Functions scope and deployment context, then redeploy.');
    if(!env.APP_ACCESS_TOKEN)throw new AppError(503,'APP_ACCESS_TOKEN is unavailable to this deployed function. Check its Functions scope and deployment context, then redeploy.');
    if(env.APP_ACCESS_TOKEN.length<32)throw new AppError(503,'APP_ACCESS_TOKEN is present but shorter than 32 characters. Generate a longer token, update Netlify and the app, then redeploy.');
  };
  const auth=request=>{
    ready();
    if(!timingSafeEqual(digest(request.headers.get('authorization')??''),digest('Bearer '+env.APP_ACCESS_TOKEN)))throw new AppError(401,'Connection token is incorrect. Check Settings.');
  };
  const sign=id=>createHmac('sha256',env.APP_ACCESS_TOKEN).update('nutrilens-job:'+id).digest('hex');
  const wrap=fn=>async request=>{try{return await fn(request);}catch(e){return json({error:e instanceof AppError?e.message:'The backend could not complete this operation. Check Netlify configuration.'},e.status??502);}};
  async function readBody(request,max=120000){
    if(!String(request.headers.get('content-type')??'').startsWith('application/json'))throw new AppError(415,'JSON required.');
    const reader=request.body?.getReader();if(!reader)throw new AppError(400,'Missing request body.');
    const chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new AppError(413,'Label text is too large.');}chunks.push(value);}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError(400,'Invalid JSON.');}
  }
  const start=wrap(async request=>{
    if(request.method!=='POST')throw new AppError(405,'Use POST.');auth(request);
    const input=validateInput(await readBody(request));
    const origin=env.URL;
    if(!origin||new URL(origin).protocol!=='https:')throw new AppError(503,'Netlify site URL is not configured.');
    // Atomic reservation across function instances: maximum 30 accepted jobs per UTC hour.
    const hour=Math.floor(now()/3600000);let reserved=false;
    for(let slot=0;slot<30;slot++){
      const result=await store.setJSON(`quota/${hour}/${slot}`,{expires:now()+2*lifetime},{onlyIfNew:true});
      if(result.modified){reserved=true;break;}
    }
    if(!reserved)throw new AppError(429,'Hourly analysis limit reached. Try again next hour.');
    const id=uuid(),key='job/'+id,expires=now()+lifetime;
    await store.setJSON(key,{state:'queued',created:now(),expires,input});
    try {
      const trigger=await fetchImpl(new URL('/.netlify/functions/worker-background',origin),{
        method:'POST',headers:{'Content-Type':'application/json','X-Job-Signature':sign(id)},
        body:JSON.stringify({id}),redirect:'error',signal:AbortSignal.timeout(15000)
      });
      if(trigger.status!==202)throw new Error('Worker not accepted');
    }catch{
      // Do not overwrite a worker that may already be running after a network timeout.
      const entry=await store.getWithMetadata(key,{type:'json'});
      if(entry?.data.state==='queued')await store.setJSON(key,{state:'failed',created:now(),expires,error:'Background analysis could not start. Check Functions deployment and site access settings.'},{onlyIfMatch:entry.etag});
      throw new AppError(502,'Background analysis could not be started reliably. Check Netlify Functions, then retry.');
    }
    return json({jobId:id,state:'queued'},202);
  });
  const worker=async request=>{
    // Background HTTP responses are discarded by Netlify. Validate before any paid call.
    try {
      ready();if(request.method!=='POST')return;
      const {id}=await readBody(request,1000);if(!idOK(id))return;
      if(!timingSafeEqual(digest(request.headers.get('x-job-signature')??''),digest(sign(id))))return;
      const key='job/'+id,entry=await store.getWithMetadata(key,{type:'json'});
      if(!entry||entry.data.state!=='queued'||entry.data.expires<=now())return;
      const job=entry.data;
      const claim=await store.setJSON(key,{state:'running',created:job.created,expires:job.expires},{onlyIfMatch:entry.etag});
      if(!claim.modified)return; // A retry or duplicate trigger must not charge twice.
      try {
        const report=await analyseImpl(job.input,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-4.1-mini'});
        await store.setJSON(key,{state:'completed',created:job.created,expires:job.expires,report});
      }catch(e){await store.setJSON(key,{state:'failed',created:job.created,expires:job.expires,error:e instanceof AppError?e.message:'Online analysis failed. Try a clearer label or check provider configuration.'});}
    }catch{ /* No label text or credential logging. Stale jobs are detected by status. */ }
  };
  const status=wrap(async request=>{
    if(!['GET','DELETE'].includes(request.method))throw new AppError(405,'Use GET or DELETE.');auth(request);
    const id=new URL(request.url).searchParams.get('id');if(!idOK(id))throw new AppError(400,'Invalid job id.');
    const key='job/'+id,job=await store.get(key,{type:'json'});
    if(!job)throw new AppError(404,'Report not found or already removed.');
    if(job.expires<=now()){await store.delete(key);throw new AppError(410,'This report expired. Scan again.');}
    if(request.method==='DELETE'){
      if(['queued','running'].includes(job.state))throw new AppError(409,'This analysis is still running.');
      await store.delete(key);return json({state:'deleted'});
    }
    if(job.state==='completed')return json({state:'completed',report:job.report});
    if(job.state==='failed')return json({state:'failed',error:job.error});
    if(now()-job.created>240000)return json({state:'failed',error:'Analysis took too long. Check the function logs and try again.'});
    return json({state:job.state});
  });
  const health=wrap(async()=>{ready();await store.get('health-probe',{type:'json'});return json({status:'ok',mode:'background'});});
  const cleanup=async()=>{
    const {blobs}=await store.list();
    for(const {key} of blobs){const record=await store.get(key,{type:'json'});if(record?.expires<=now())await store.delete(key);}
    return new Response(null,{status:204});
  };
  return {start,worker,status,health,cleanup};
}
