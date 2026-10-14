import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"
function harness() {
  const window=new EventTarget(),document=new EventTarget(),values=new Map(),timers=new Map(),calls=[]
  document.visibilityState="visible"
  let online=true,id=0,handler
  Object.assign(window,{document,setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v))}})
  const navigator={get onLine(){return online}}
  const load=(file,deps)=>{const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,window,navigator,AbortController,Event,fetch:async(url,options)=>{calls.push({path:new URL(url).pathname,method:options?.method??"GET"});return handler(new URL(url).pathname,options)},require:p=>{assert(p in deps,p);return deps[p]}});return exports}
  const availability=load("../src/offline/apiAvailability.ts",{})
  const client=load("../src/api/httpClient.ts",{"./config":{API_URL:"https://synthetic.test",API_CONFIG_ERROR:""},"../offline/apiAvailability":availability,"../constants/session":{TOKEN_KEY:"token",USER_KEY:"user",REFRESH_KEY:"refresh"}})
  const facade=load("../src/services/bunkermodeApi.ts",{"../api/httpClient":client,"../types/taskContract":{}})
  values.set("user",'{"id":1}');values.set("token","synthetic");values.set("refresh","synthetic");availability.setApiAvailability("available")
  return {...client,availability,facade,calls,timers,values,window,set handler(v){handler=v},set online(v){online=v},fireTimeout(delay){const entry=[...timers].find(([,t])=>t.delay===delay);assert(entry);timers.delete(entry[0]);entry[1].fn()}}
}
const healthy=()=>Response.json({status:"ok",database:"ok"})
async function flushMicrotasks(){await new Promise(setImmediate);for(let i=0;i<8;i++)await Promise.resolve()}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
test("500 isolado verifica readiness; sucesso alheio não resolve operação",async()=>{
  const h=harness();h.handler=async p=>p==="/health/database"?healthy():Response.json({},{status:p==="/objetivos"?500:200})
  const failed=await h.request("/objetivos");assert.equal(failed.status,500);assert.equal(h.availability.getApiAvailability(),"available")
  assert.equal((await h.request("/tarefas")).ok,true);assert.equal(failed.ok,false);assert.equal(h.calls.filter(x=>x.path==="/health/database").length,1)
})
test("indisponibilidade permanece até readiness, com probe compartilhado",async()=>{
  const h=harness();let resolve;h.handler=async p=>p==="/health/database"?new Promise(done=>{resolve=done}):Response.json({},{status:500})
  const a=h.request("/objetivos"),b=h.request("/tarefas");await new Promise(setImmediate);assert.equal(h.calls.filter(x=>x.path==="/health/database").length,1)
  resolve(Response.json({status:"error"},{status:503}));await h.checkApiHealth();await Promise.all([a,b]);assert.equal(h.availability.getApiAvailability(),"unavailable")
  h.handler=async p=>p==="/health/database"?Response.json({status:"error"},{status:503}):Response.json({})
  await h.request("/objetivos");await h.checkApiHealth();assert.equal(h.availability.getApiAvailability(),"unavailable")
  h.handler=async()=>healthy();await h.checkApiHealth();assert.equal(h.availability.getApiAvailability(),"available")
})
test("regressão: HTTP 200 com readiness pendente deve devolver a resposta original",async()=>{
  const h=harness(),health=deferred();h.availability.setApiAvailability("unknown")
  h.handler=p=>p==="/health/database"?health.promise:Promise.resolve(Response.json({id:1}))
  let settled=false;const pending=h.request("/usuarios/me").then(result=>{settled=true;return result})
  await flushMicrotasks()
  assert.equal(h.calls.filter(x=>x.path==="/health/database").length,1)
  assert.ok(h.getApiDiagnostics().some(event=>event.path==="/usuarios/me"&&event.method==="GET"))
  assert.equal(h.getApiDiagnostics().some(event=>event.path==="/health/database"),false)
  assert.equal(settled,true,"resposta HTTP válida ficou bloqueada pelo probe pendente")
  assert.deepEqual((await pending).data,{id:1})
  health.resolve(healthy());await flushMicrotasks()
  assert.ok(h.getApiDiagnostics().some(event=>event.path==="/health/database"&&event.method==="GET"))
  assert.equal(h.availability.getApiAvailability(),"available")
})
test("regressão: HTTP 500 devolve o erro original enquanto readiness está pendente",async()=>{
  const h=harness(),health=deferred();h.availability.setApiAvailability("unknown")
  h.handler=p=>p==="/health/database"?health.promise:Promise.resolve(Response.json({message:"erro original"},{status:500}))
  let settled=false;const pending=h.request("/objetivos").then(result=>{settled=true;return result})
  await flushMicrotasks()
  assert.equal(settled,true,"erro HTTP conclusivo ficou bloqueado pelo probe pendente")
  const result=await pending;assert.equal(result.status,500);assert.equal(result.data.message,"erro original")
  health.resolve(Response.json({status:"error"},{status:503}));await flushMicrotasks()
  assert.equal(h.availability.getApiAvailability(),"unavailable")
})
test("timeout original retorna sem aguardar readiness pendente",async()=>{
  const h=harness(),health=deferred();h.availability.setApiAvailability("unknown")
  h.handler=(p,{signal})=>p==="/health/database"?health.promise:new Promise((_ok,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error(),{name:"AbortError"}))))
  let settled=false;const pending=h.request("/usuarios/me").then(result=>{settled=true;return result});await flushMicrotasks();h.fireTimeout(30000);await flushMicrotasks()
  assert.equal(settled,true,"timeout original ficou bloqueado pelo probe pendente")
  health.resolve(Response.json({status:"error"},{status:503}));await flushMicrotasks()
  const result=await pending;assert.equal(result.status,0);assert.match(result.data.message,/demorou demais/)
  assert.equal(h.availability.getApiAvailability(),"unavailable")
})
test("duas respostas com readiness pendente compartilham probe sem bloquear resultados",async()=>{
  const h=harness(),health=deferred();h.availability.setApiAvailability("unknown")
  h.handler=p=>p==="/health/database"?health.promise:Promise.resolve(Response.json({path:p}))
  const a=h.request("/usuarios/me"),b=h.request("/tarefas")
  await flushMicrotasks()
  assert.equal((await a).ok,true);assert.equal((await b).ok,true)
  assert.equal(h.calls.filter(x=>x.path==="/health/database").length,1)
  health.resolve(healthy());await flushMicrotasks()
  assert.equal(h.availability.getApiAvailability(),"available")
})
test("health lento atualiza indisponibilidade depois sem rejeitar a operação ou a Promise",async()=>{
  const h=harness();h.availability.setApiAvailability("unknown")
  h.handler=(p,{signal})=>p==="/health/database"?new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error(),{name:"AbortError"})))):Promise.resolve(Response.json({ok:true}))
  assert.equal((await h.request("/tarefas")).ok,true)
  await flushMicrotasks()
  assert.equal(h.timers.size,1)
  h.fireTimeout(30000);await h.checkApiHealth();await flushMicrotasks()
  assert.equal(h.availability.getApiAvailability(),"unavailable")
  assert.equal(h.getApiDiagnostics().find(event=>event.path==="/health/database").failure,"timeout")
})
test("sessão não aborta aos 6s; timeout cancela transporte sem reenvio de mutação",async()=>{
  const h=harness();h.handler=async(p,{signal})=>p==="/health/database"?healthy():new Promise((_ok,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error(),{name:"AbortError"}))))
  const me=h.facade.api.getCurrentUser("synthetic");assert.equal([...h.timers.values()].some(t=>t.delay===6000),false)
  h.fireTimeout(30000);assert.equal((await me).status,0);await h.checkApiHealth()
  const post=h.request("/tarefas",{method:"POST"});h.fireTimeout(30000);assert.equal((await post).status,0)
  assert.equal(h.calls.filter(x=>x.path==="/tarefas").length,1);assert.equal(h.availability.getApiAvailability(),"available")
  assert.equal(h.getApiDiagnostics().filter(x=>x.failure==="timeout").length,2)
})
for(const status of [401,403,408,429,500,503]) test(`HTTP ${status} isolado não equivale a outage`,async()=>{
  const h=harness();h.handler=async p=>p==="/health/database"?healthy():Response.json({},{status})
  assert.equal((await h.request("/objetivos")).ok,false);assert.equal(h.availability.getApiAvailability(),"available")
})
test("falha de transporte da conta anterior não contamina a atual",async()=>{
  const h=harness();let reject;h.handler=()=>new Promise((_ok,fail)=>{reject=fail});const pending=h.request("/objetivos")
  h.values.set("user",'{"id":2}');reject(new TypeError("network"));assert.equal((await pending).status,0);assert.equal(h.availability.getApiAvailability(),"available");assert.equal(h.calls.length,1)
})
test("offline não faz probe; reconexão recupera sem polling saudável",async()=>{
  const h=harness();h.handler=async()=>healthy();h.online=false;h.window.dispatchEvent(new Event("offline"));await h.request("/objetivos");assert.equal(h.calls.length,0);assert.equal(h.timers.size,0)
  h.online=true;h.window.dispatchEvent(new Event("online"));await h.checkApiHealth();await new Promise(setImmediate);assert.equal(h.availability.getApiAvailability(),"available");assert.equal(h.timers.size,0)
})
test("diagnóstico não contém query, IDs, credenciais ou corpos",async()=>{
  const h=harness();h.handler=async()=>Response.json({});await h.request("/tarefas/123?private=secret",{method:"PATCH",body:{senha:"private"}})
  const log=JSON.stringify(h.getApiDiagnostics());assert.match(log,/tarefas\/:id/);assert.doesNotMatch(log,/secret|private|synthetic|senha/)
})

test("timeout durante leitura do corpo cancela a operação em vez de retornar sucesso vazio",async()=>{
  const h=harness()
  h.handler=async(p,{signal})=>p==="/health/database"?healthy():({status:200,ok:true,json:()=>new Promise((_ok,reject)=>signal.addEventListener("abort",()=>reject(Object.assign(new Error(),{name:"AbortError"}))))})
  const pending=h.request("/usuarios/me",{timeoutMs:10})
  await new Promise(setImmediate);h.fireTimeout(10)
  assert.equal((await pending).ok,false);assert.equal(h.getApiDiagnostics().find(x=>x.failure==="timeout").durationMs>=0,true)
})
test("health antigo após desconexão não sobrepõe o readiness da nova conexão",async()=>{
  const h=harness();let oldResolve,newResolve
  h.handler=()=>new Promise(resolve=>{oldResolve=resolve})
  const old=h.checkApiHealth();h.online=false;h.window.dispatchEvent(new Event("offline"))
  h.online=true;h.window.dispatchEvent(new Event("online"));h.handler=()=>new Promise(resolve=>{newResolve=resolve})
  const fresh=h.checkApiHealth();newResolve(healthy());await fresh
  oldResolve(Response.json({status:"error"},{status:503}));await old
  assert.equal(h.availability.getApiAvailability(),"available")
})
test("resposta de conta anterior não altera disponibilidade nem autoriza sessão atual",async()=>{
  const h=harness(),health=deferred(),response=deferred();h.availability.setApiAvailability("unknown")
  h.handler=p=>p==="/health/database"?health.promise:response.promise
  const pending=h.request("/usuarios/me");await flushMicrotasks();h.values.set("user",'{"id":2}')
  response.resolve(Response.json({id:1}));await flushMicrotasks()
  const result=await pending;assert.equal(result.status,0);assert.match(result.data.message,/sessão mudou/)
  health.resolve(healthy());await flushMicrotasks()
  assert.equal(h.availability.getApiAvailability(),"unknown")
  assert.equal(h.calls.filter(x=>x.path==="/health/database").length,0)
})
test("deduplicação respeita orçamento de timeout de cada leitura",async()=>{
  const h=harness(),pending=[]
  h.handler=()=>new Promise(resolve=>{pending.push(resolve)})
  const first=h.request("/objetivos",{timeoutMs:5}),same=h.request("/objetivos",{timeoutMs:5})
  assert.equal(first,same);assert.equal(h.calls.length,1)
  const other=h.request("/objetivos",{timeoutMs:20});assert.equal(h.calls.length,2)
  pending.forEach(resolve=>resolve(Response.json({})));await Promise.all([first,other])
  assert.notEqual(first,other);assert.equal(h.timers.size,0)
})
