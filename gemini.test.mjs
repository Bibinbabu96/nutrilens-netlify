import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput,buildReport,scores,analyse} from './lib/analysis.mjs';
const text='Ingredients: oats, milk. Nutrition per 100 g: 200 kcal, protein 20 g.';
const input=(n=1,goal='Fat loss')=>({goal,compare:n>1,products:Array.from({length:n},(_,i)=>({id:'p'+i,text}))});
const product=(id='p0',extra={})=>({id,name:'Food '+id,summary:'Label assessment',confidence:'high',basis:'100g',evidence:'Per 100 g; 200 kcal, protein 20 g',nutrition:{kcal:200,protein:20,fiber:5,sugar:4,saturatedFat:1,sodiumMg:100},ingredients:[{name:'oats',kind:'information',reason:'Grain ingredient'}],allergens:['Contains milk'],cautions:[],strengths:['Protein'],limitations:[],goalAdvice:'Consider portion size.',rescanNeeded:false,...extra});
test('one or two-to-five unique products only',()=>{
 for(let n=1;n<=5;n++)assert.equal(validateInput(input(n)).products.length,n);
 assert.throws(()=>validateInput(input(6)));
 assert.throws(()=>validateInput({...input(),compare:true}));
 assert.throws(()=>validateInput({...input(2),compare:false}));
 assert.throws(()=>validateInput({...input(2),products:[{id:'p0',text},{id:'p0',text}]}));
 assert.throws(()=>validateInput({...input(),goal:'extreme dieting'}));
});
test('fat loss and weight gain prioritize energy differently',()=>{
 const lower=product('p0',{nutrition:{...product().nutrition,kcal:100,protein:10}});
 const higher=product('p1',{nutrition:{...product().nutrition,kcal:400,protein:40}});
 assert.ok(scores(lower,'Fat loss').goalFit>scores(higher,'Fat loss').goalFit);
 assert.ok(scores(higher,'Weight gain').goalFit>scores(lower,'Weight gain').goalFit);
});
test('muscle goal prioritizes protein density',()=>{
 const low=product('p0',{nutrition:{...product().nutrition,protein:2}});
 assert.ok(scores(product(),'Muscle gain').goalFit>scores(low,'Muscle gain').goalFit);
});
test('missing or uncertain values never become zero or safety scores',()=>{
 const p=product('p0',{confidence:'medium'});
 assert.deepEqual(scores(p,'Fat loss'),{quality:null,goalFit:null});
 const missing=product('p0',{nutrition:{...product().nutrition,fiber:null}});
 assert.equal(scores(missing,'General fitness').goalFit,null);
 assert.equal(scores(missing,'Fat loss').quality,null);
 assert.equal(scores(product('p0',{evidence:''}),'Fat loss').goalFit,null);
 assert.equal(scores(product('p0',{rescanNeeded:true}),'Fat loss').goalFit,null);
});
test('comparison selects a consistent-basis winner and preserves IDs',()=>{
 const raw={products:[product('p1',{nutrition:{...product().nutrition,kcal:500}}),product('p0')]};
 const report=buildReport(raw,input(2));assert.equal(report.winnerId,'p0');assert.deepEqual(report.products.map(x=>x.id),['p0','p1']);
});
test('mixed units, ties and incomplete products have no unique winner',()=>{
 assert.equal(buildReport({products:[product(),product('p1',{basis:'100ml'})]},input(2)).winnerId,null);
 assert.equal(buildReport({products:[product(),product('p1')]},input(2)).winnerId,null);
 assert.equal(buildReport({products:[product(),product('p1',{confidence:'low'})]},input(2)).ranking.length,0);
});
test('provider must return correct identity, finite plausible values and valid schema',()=>{
 assert.throws(()=>buildReport({products:[product('wrong')]},input()));
 assert.throws(()=>buildReport({products:[product('p0',{nutrition:{...product().nutrition,kcal:1200}})]},input()));
 assert.throws(()=>buildReport({products:[product('p0',{confidence:'safe'})]},input()));
 assert.throws(()=>buildReport({products:[{...product(),safePercentage:100}]},input()));
});
test('Gemini request preserves structured report contract for one and five scans',async()=>{
 for(const n of [1,5]){
  let request;
  const report=await analyse(input(n),{apiKey:'test-key',fetchImpl:async(url,options)=>{
   assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent');
   assert.equal(options.headers['x-goog-api-key'],'test-key');assert.equal(options.redirect,'error');
   request=JSON.parse(options.body);
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({products:input(n).products.map(p=>product(p.id))})}]}}]});
  }});
  assert.equal(report.products.length,n);
  assert.ok(request.systemInstruction.parts[0].text.includes('UNTRUSTED'));
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text),input(n));
  assert.equal(request.generationConfig.responseSchema.properties.products.items.properties.nutrition.properties.fiber.nullable,true);
 }
});
test('Gemini failures are actionable and do not expose raw response secrets',async()=>{
 for(const [status,pattern] of [[429,/Gemini quota/],[403,/access denied/],[404,/model unavailable/],[400,/rejected/],[500,/could not complete/]]){
  await assert.rejects(analyse(input(),{apiKey:'test',fetchImpl:async()=>new Response('private secret',{status})}),e=>pattern.test(e.message)&&!e.message.includes('private secret'));
 }
});
test('blocked, truncated, malformed and mismatched Gemini output cannot become reports',async()=>{
 for(const payload of [
  {promptFeedback:{blockReason:'SAFETY'}},
  {candidates:[{finishReason:'MAX_TOKENS'}]},
  {candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]},
  {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({products:[product('wrong')]})}]}}]}
 ])await assert.rejects(analyse(input(),{apiKey:'test',fetchImpl:async()=>Response.json(payload)}));
});
