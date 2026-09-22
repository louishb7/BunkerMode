import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'})
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})
const vite=await createServer({appType:'custom',logLevel:'silent',root:new URL('..',import.meta.url).pathname,server:{middlewareMode:true}})
const load=path=>vite.ssrLoadModule(`/src/${path}`)
const [{default:ActionsMenu},{default:DaySelector},{default:TaskCard},{default:ObjetivoCard},{validateAuth},preference]=await Promise.all([
 load('components/ui/ActionsMenu.tsx'),load('features/calendar/components/DaySelector.tsx'),load('features/tasks/components/TaskCard.tsx'),load('features/objectives/components/ObjetivoCard.tsx'),load('features/auth/authValidation.ts'),load('theme/preference.ts'),
])
after(()=>vite.close())
async function mount(Component,props) {
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 await act(async()=>root.render(React.createElement(Component,props)))
 return {container,async close(){await act(async()=>root.unmount());container.remove()}}
}
const click=async element=>act(async()=>element.click())
const key=async(element,key)=>act(async()=>element.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true})))

test('menu: teclado, seleção, Escape e retorno de foco',async()=>{
 let selected=''
 const view=await mount(ActionsMenu,{label:'Ações',items:[{label:'Editar',onSelect:()=>selected='edit'},{label:'Remover',onSelect:()=>selected='delete',danger:true}]})
 const trigger=view.container.querySelector('button');trigger.focus();await key(trigger,'ArrowDown')
 assert.equal(trigger.getAttribute('aria-expanded'),'true')
 assert.equal(document.activeElement.textContent,'Editar')
 await key(document.activeElement,'ArrowDown');assert.equal(document.activeElement.textContent,'Remover')
 await key(document.activeElement,'Escape');assert.equal(document.querySelector('[role=menu]'),null);assert.equal(document.activeElement,trigger)
 await click(trigger);await click(document.querySelector('[role=menuitem]'));assert.equal(selected,'edit');assert.equal(document.activeElement,trigger)
 await view.close()
})

test('calendário diferencia hoje do contexto selecionado e emite a data escolhida',async()=>{
 const today=new Date(2026,8,9),selected=new Date(2026,8,8)
 const days=Array.from({length:7},(_,i)=>new Date(2026,8,7+i));let chosen
 const view=await mount(DaySelector,{todayDate:today,selectedDate:selected,weekDays:days,onSelectDate:date=>chosen=date})
 const current=view.container.querySelector('[aria-current=date]'),pressed=view.container.querySelector('[aria-pressed=true]')
 assert.notEqual(current,pressed);assert.equal(current.getAttribute('aria-pressed'),'false')
 await click(current);assert.equal(chosen.getTime(),today.getTime());await view.close()
})

test('tarefas preservam conclusão e administração sem ação manual de falha',async()=>{
 let complete=0,edit=0
 const task={id:1,titulo:'Revisar',status_code:'NAO_REALIZADA',permissions:{can_complete:true,can_edit:true,can_delete:false,can_pin:false}}
 const view=await mount(TaskCard,{task,onComplete:()=>complete++,onEdit:()=>edit++})
 assert.match(view.container.textContent,/Não realizada/);assert.doesNotMatch(view.container.textContent,/falha/i)
 await click(view.container.querySelector('[aria-label="Concluir: Revisar"]'));assert.equal(complete,1)
 await click(view.container.querySelector('[aria-haspopup=menu]'));await click(document.querySelector('[role=menuitem]'));assert.equal(edit,1)
 await view.close()
 const focus=await mount(TaskCard,{task:{...task,status_code:'PENDENTE'},variant:'focus',onComplete:()=>complete++})
 assert.equal(focus.container.querySelector('[aria-haspopup=menu]'),null)
 assert.equal(focus.container.querySelector('button').textContent,'Concluir');await focus.close()
})

test('objetivo apresenta estado como informação e administra os quatro estados no menu',async()=>{
 let status='',created=0
 const props={objetivo:{id:1,titulo:'Direção',status:'ativo'},tasks:[],tasksEnabled:true,loading:false,tasksLoading:false,tasksError:'',onCreateTask:()=>created++,onUpdateStatus:value=>status=value,onEdit:()=>{},onDelete:()=>{}}
 const view=await mount(ObjetivoCard,props)
 assert.equal(view.container.querySelector('select'),null)
 assert.match(view.container.textContent,/Ativo/);assert.doesNotMatch(view.container.textContent,/Nenhuma tarefa vinculada/)
 await click([...view.container.querySelectorAll('button')].find(b=>b.textContent.includes('Adicionar tarefa')));assert.equal(created,1)
 await click(view.container.querySelector('[aria-haspopup=menu]'))
 for(const name of ['Pausado','Concluído','Abandonado']) assert.match(document.querySelector('[role=menu]').textContent,new RegExp(name))
 await click([...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent==='Status: Pausado'));assert.equal(status,'pausado');await view.close()
 const standalone=await mount(ObjetivoCard,{...props,tasksEnabled:false})
 assert.doesNotMatch(standalone.container.textContent,/Adicionar tarefa|Carregando tarefas/);await standalone.close()
})

test('política de cadastro e login possui limites distintos e não normaliza senha',()=>{
 const good={usuario:' pessoa ',email:' Pessoa@example.com ',senha:'abcde1'}
 assert.equal(validateAuth(good,true),'')
 for(const patch of [{usuario:'ab'},{usuario:'a'.repeat(33)},{email:'x@'},{email:'a'.repeat(255)},{senha:'ab123'},{senha:'abcd!1'},{senha:'123456'},{senha:'abcdef'}]) assert.notEqual(validateAuth({...good,...patch},true),'')
 assert.equal(validateAuth({...good,senha:' ééééé１２ '},true),'')
 assert.equal(validateAuth({email:'pessoa',senha:'a'},false),'')
 assert.equal(validateAuth({email:'pessoa',senha:'a'.repeat(129)},false),'')
})

test('tema local aplica light/dark e devolve controle ao sistema',()=>{
 for(const value of ['light','dark']) {preference.setThemePreference(value);assert.equal(document.documentElement.dataset.theme,value);assert.equal(preference.getThemePreference(),value)}
 preference.setThemePreference('system');assert.equal(document.documentElement.hasAttribute('data-theme'),false);assert.equal(preference.getThemePreference(),'system')
})
