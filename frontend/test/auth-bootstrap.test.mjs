import assert from "node:assert/strict"
import {after,test} from "node:test"
import React,{act} from "react"
import {createRoot} from "react-dom/client"
import {MemoryRouter,useLocation} from "react-router-dom"
import {JSDOM} from "jsdom"
import {createServer} from "vite"
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/'})
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,Event:dom.window.Event})
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator})
const vite=await createServer({root:new URL('..',import.meta.url).pathname,appType:'custom',logLevel:'silent',server:{middlewareMode:true}})
const {AuthProvider,useAuth}=await vite.ssrLoadModule('/src/context/AuthContext.tsx')
const availability=await vite.ssrLoadModule('/src/offline/apiAvailability.ts')
const {default:App}=await vite.ssrLoadModule('/src/app/App.tsx')
after(async()=>{await vite.close();dom.window.close()})
const stored={id:1,usuario:'cache',enabled_modules:['tasks']}
async function mount(handler,token='expired') {
  window.localStorage.clear();window.localStorage.setItem('bunkermode_token',token);window.localStorage.setItem('bunkermode_refresh_token','synthetic');window.localStorage.setItem('bunkermode_usuario',JSON.stringify(stored))
  availability.setApiAvailability('available');globalThis.fetch=handler
  let auth,path
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el)
  function Probe(){auth=useAuth();path=useLocation().pathname;return React.createElement('span',null,`${auth.booting}:${auth.sessionMode}:${auth.user?.usuario}`)}
  await act(async()=>{root.render(React.createElement(MemoryRouter,{initialEntries:["/"]},React.createElement(AuthProvider,null,React.createElement(Probe),React.createElement(App))));for(let i=0;i<8;i++)await new Promise(setImmediate)})
  return {get auth(){return auth},get path(){return path},async close(){await act(async()=>root.unmount());el.remove()}}
}
test('refresh não libera bootstrap antes de /me atualizado; módulos em cache não viram destino',async()=>{
  let resolve,reads=0
  const view=await mount(async(url)=>{
    if(url.endsWith('/health/database'))return Response.json({status:'ok',database:'ok'})
    if(url.endsWith('/auth/refresh'))return Response.json({access_token:'renewed',refresh_token:'rotated'})
    if(url.endsWith('/usuarios/me'))return ++reads===1?Response.json({},{status:401}):new Promise(done=>{resolve=done})
    return Response.json([])
  })
  try{
    assert.equal(view.path,'/');assert.equal(view.auth.booting,true);assert.equal(view.auth.authenticated,false);assert.equal(view.auth.sessionMode,'none')
    await act(async()=>{resolve(Response.json({...stored,usuario:'remote',enabled_modules:['objectives']}));for(let i=0;i<8;i++)await new Promise(setImmediate)})
    assert.equal(view.path,'/objetivos');assert.equal(view.auth.booting,false);assert.equal(view.auth.sessionMode,'online');assert.deepEqual(view.auth.user.enabled_modules,['objectives']);assert.equal(reads,2)
  }finally{await view.close()}
})
test('falha isolada de /me com readiness saudável preserva sessão local e recupera no foco',async()=>{
  let failed=true,reads=0
  const view=await mount(async url=>{
    if(url.endsWith('/health/database'))return Response.json({status:'ok',database:'ok'})
    if(url.endsWith('/usuarios/me')){reads++;return failed?Response.json({},{status:503}):Response.json({...stored,usuario:'remote'})}
    return Response.json([])
  },'valid')
  try{
    assert.equal(view.auth.sessionMode,'local');assert.equal(window.localStorage.getItem('bunkermode_refresh_token'),'synthetic')
    failed=false
    await act(async()=>{window.dispatchEvent(new window.Event('focus'));for(let i=0;i<8;i++)await new Promise(setImmediate)})
    assert.equal(view.auth.sessionMode,'online');assert.equal(view.auth.user.usuario,'remote');assert.equal(reads,2)
  }finally{await view.close()}
})
