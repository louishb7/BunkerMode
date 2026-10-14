import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import vm from "node:vm"
import ts from "typescript"
function load(file,context,deps){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{...context,exports,require:p=>{assert(p in deps,p);return deps[p]}});return exports}
function facade(){const window=new EventTarget(),calls=[];let resolve,handler=async()=>({ok:true,status:204,data:null}),day='2026-10-14T12:00:00Z'
 class Clock extends Date{constructor(value){super(value??day)}}
 const {api}=load('../src/services/bunkermodeApi.ts',{window,Date:Clock},{'../api/httpClient':{request:(...args)=>{calls.push(args);return handler(...args)}},'../types/taskContract':{}})
 return {api,window,calls,set handler(v){handler=v},set day(v){day=v}}
}
test('preparação compartilhada por sessão/dia; invalida após comando oficial e nova data',async()=>{
 const h=facade();let finish;h.handler=()=>new Promise(resolve=>{finish=resolve})
 const first=h.api.materializeTaskRecurrences('session','America/Recife'),second=h.api.materializeTaskRecurrences('session','America/Recife')
 assert.equal(h.calls.length,1);finish({ok:true,status:204,data:null});await Promise.all([first,second])
 await h.api.materializeTaskRecurrences('session','America/Recife');assert.equal(h.calls.length,1)
 h.handler=async()=>({ok:true,status:204,data:null});h.window.dispatchEvent(new CustomEvent('bunkermode-official-change',{detail:{key:'tasks:all'}}))
 await h.api.materializeTaskRecurrences('session','America/Recife');assert.equal(h.calls.length,2)
 h.day='2026-10-15T12:00:00Z';await h.api.materializeTaskRecurrences('session','America/Recife');assert.equal(h.calls.length,3)
 await h.api.materializeTaskRecurrences('new-session','America/Recife');assert.equal(h.calls.length,4)
})
test('falha de preparação nunca é memorizada como sucesso',async()=>{
 const h=facade();h.handler=async()=>({ok:false,status:503,data:{}})
 assert.equal((await h.api.materializeTaskRecurrences('session')).ok,false)
 h.handler=async()=>({ok:true,status:204,data:null});assert.equal((await h.api.materializeTaskRecurrences('session')).ok,true);assert.equal(h.calls.length,2)
})
test('preparação da sessão depende de autenticação remota, módulo Tasks e conectividade',async()=>{
 const calls=[],effects=[];let online=true,retry
 const {useSessionTaskPreparation}=load('../src/features/tasks/hooks/useSessionTaskPreparation.ts',{navigator:{get onLine(){return online}}},{
  react:{useEffect:fn=>effects.push(fn)},'../../../services/bunkermodeApi':{api:{materializeTaskRecurrences:async(...args)=>{calls.push(args);return {ok:true}}}},
  '../../../modules/moduleCatalog':{getEnabledModules:user=>(user?.enabled_modules??[]).map(key=>({key}))},
  '../../../offline/apiAvailability':{getApiAvailability:()=>"available",requestApiRecovery(){},subscribeApiRetry:fn=>{retry=fn;return ()=>{retry=null}}},
 })
 const props={authenticated:true,booting:false,sessionMode:'online',token:'test',user:{id:1,enabled_modules:['tasks'],timezone:'America/Recife'},handleUnauthorized:()=>false}
 for(const overrides of [{authenticated:false},{booting:true},{sessionMode:'local'},{user:{enabled_modules:['objectives']}},{}]){effects.length=0;useSessionTaskPreparation({...props,...overrides});const stop=effects[0]();await new Promise(setImmediate);stop?.()}
 assert.equal(calls.length,1)
 online=false;effects.length=0;useSessionTaskPreparation(props);const stop=effects[0]();await new Promise(setImmediate);assert.equal(calls.length,1)
 online=true;await retry();assert.equal(calls.length,2);stop()
})
