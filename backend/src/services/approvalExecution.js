import {AsyncLocalStorage} from 'node:async_hooks';
export const approvalTransaction=new AsyncLocalStorage();
// This symbol is never set from headers, cookies, body or query parameters.
export const APPROVED_EXECUTION=Symbol('approved administrative execution');
export function transactionClient(client,reviewerId){return {reviewerId,query:(sql,params)=>/^\s*SET TRANSACTION /i.test(sql)?Promise.resolve({rows:[],rowCount:0}):client.query(sql,params)};}
// Dispatch through the same registered router, validators and operation guards after
// rebuilding the requester from the database. No HTTP call or client-supplied handler.
export async function executeRouter(router,source,{method,path,body,user}){
 const req=Object.create(source);
 Object.assign(req,{method,url:path,originalUrl:path,baseUrl:'',body,user,session:{locked:false},params:{},query:{}});
 req[APPROVED_EXECUTION]=true;
 return new Promise((resolve,reject)=>{
  let status=200,done=false;
  const finish=data=>{if(!done){done=true;resolve({status,data});}return res;};
  const res={headersSent:false,locals:{},status(n){status=n;return this;},set(){return this;},setHeader(){},getHeader(){},
   json(data){return finish(data);},send(data){return finish(data);},sendStatus(n){status=n;return finish(null);},end(){return finish(null);}};
  router.handle(req,res,error=>reject(error||new Error('Administrative operation route was not found')));
 });
}
