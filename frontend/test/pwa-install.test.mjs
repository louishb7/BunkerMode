import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"
import vm from "node:vm"
import ts from "typescript"
import { JSDOM } from "jsdom"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
const dom = new JSDOM("<!doctype html><html><body></body></html>", {url:"http://localhost"})
Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true})
const navigator = dom.window.navigator
let inStandalone = false
window.matchMedia = () => ({matches:inStandalone})
after(() => dom.window.close())
function load(file, dependencies = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.React, esModuleInterop:true},
  }).outputText, {exports, window, navigator, require: name => {assert(name in dependencies, name);return dependencies[name]}})
  return exports
}
const policy = load("../src/pwa/installPolicy.ts")
const device = (userAgent, platform="Linux", maxTouchPoints=0) => ({userAgent, platform, maxTouchPoints})
const desktop = device("Mozilla/5.0 Windows Chrome/140 Safari/537.36")
const android = device("Mozilla/5.0 Android Chrome/140 Mobile Safari/537.36", "Linux", 5)
const ipad = device("Mozilla/5.0 Macintosh AppleWebKit/605.1 Version/18.0 Safari/605.1", "MacIntel", 5)
function setDevice(value) {for(const [key, item] of Object.entries(value)) Object.defineProperty(navigator,key,{configurable:true,value:item})}
async function mount(value) {
  setDevice(value)
  const {default: Banners} = load("../src/components/system/PwaBanners.tsx", {
    react:React, "lucide-react":{X:()=>null}, "virtual:pwa-register":{registerSW:()=>async()=>{}},
    "../../context/SyncStatusContext":{useSyncStatus:()=>({message:""})}, "../../pwa/installPolicy":policy,
  })
  const container = document.createElement("div");document.body.append(container)
  const root=createRoot(container)
  await act(async()=>root.render(React.createElement(Banners)))
  const prompt = async () => {
    const event = new window.Event("beforeinstallprompt",{cancelable:true})
    event.prompt=async()=>{};event.userChoice=Promise.resolve({outcome:"accepted"})
    await act(async()=>window.dispatchEvent(event));return event
  }
  return {container,prompt,close:async()=>{await act(async()=>root.unmount());container.remove()}}
}
test("dispositivo, não largura: desktop estreito e tablet Windows não são mobile; iPadOS é",()=>{
  assert.equal(policy.isMobileInstallDevice(desktop),false)
  assert.equal(policy.isMobileInstallDevice({...desktop,maxTouchPoints:10}),false)
  assert.equal(policy.isMobileInstallDevice(android),true)
  assert.equal(policy.isMobileInstallDevice(ipad),true)
  assert.equal(policy.isIosSafari(ipad),true)
  assert.equal(policy.isIosSafari(device("iPhone CriOS Safari", "iPhone",5)),false)
})
test("desktop preserva prompt nativo e nunca recebe CTA próprio",async()=>{
  inStandalone=false;window.localStorage.clear()
  const view=await mount(desktop)
  try {const event=await view.prompt();assert.equal(event.defaultPrevented,false);assert.equal(view.container.querySelector('[aria-label="Instalação do BunkerMode"]'),null)}finally{await view.close()}
})
test("Android preserva beforeinstallprompt mobile e dispensa por 30 dias entre sessões",async()=>{
  window.localStorage.clear()
  const view=await mount(android)
  try {
    assert.equal((await view.prompt()).defaultPrevented,true)
    assert.ok(view.container.querySelector('[aria-label="Instalação do BunkerMode"]'))
    await act(async()=>view.container.querySelector('[aria-label="Fechar convite de instalação"]').click())
    assert.equal(view.container.querySelector('[aria-label="Instalação do BunkerMode"]'),null)
    assert.equal(policy.installDismissed(window.localStorage),true)
    const until=Number(window.localStorage.getItem(policy.INSTALL_DISMISS_KEY))
    assert.equal(policy.installDismissed(window.localStorage,until+1),false)
  }finally{await view.close()}
  const reload=await mount(android)
  try {await reload.prompt();assert.equal(reload.container.querySelector('[aria-label="Instalação do BunkerMode"]'),null)}finally{await reload.close()}
})
test("iPadOS Safari mostra instrução mesmo com largura desktop; standalone silencia CTA",async()=>{
  window.localStorage.clear()
  const view=await mount(ipad)
  try {
    const install=[...view.container.querySelectorAll('button')].find(x=>x.textContent==='Instalar')
    assert.ok(install)
    await act(async()=>install.click())
    assert.match(view.container.textContent,/Compartilhar → Adicionar à Tela de Início/)
  }finally{await view.close()}
  inStandalone=true
  const standalone=await mount(ipad)
  try {await standalone.prompt();assert.equal(standalone.container.querySelector('[aria-label="Instalação do BunkerMode"]'),null)}finally{await standalone.close();inStandalone=false}
})
