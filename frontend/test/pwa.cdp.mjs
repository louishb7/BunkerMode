import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:http"
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"

const exec = promisify(execFile)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const user = (id) => ({ id, usuario: `pwa-${id}`, email: `pwa${id}@local.test`, enabled_modules: ["tasks", "objectives", "finances"], timezone: "America/Recife", created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date()).map((part) => [part.type, part.value]))
const today = `${todayParts.day}-${todayParts.month}-${todayParts.year}`
const task = (id, ownerId) => ({ id, titulo: `Tarefa do usuário ${ownerId}`, instrucao: null, prioridade: 1, prazo: today, status: "PENDENTE", status_code: "PENDENTE", status_label: "Pendente", is_pinned: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, user_id: ownerId, responsavel_id: ownerId, criada_por_id: ownerId, objetivo_id: null, recurrence: null, permissions: { can_complete: true, can_edit: true, can_delete: true, can_pin: true, can_view_history: true, can_reopen: true } })

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function until(check, label, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await check()) return } catch { /* navegação em andamento */ }
    await delay(150)
  }
  throw new Error(`Tempo esgotado: ${label}`)
}

class CDP {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || response.exceptionDetails.exception?.description)
    return response.result.value
  }
  close() { this.socket.close() }
}

async function main() {
  const browser = "/usr/bin/brave-browser"
  let domainMutations = 0
  let loginAttempts = 0
  let refreshCount = 0
  const api = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return }
    const pathname = new URL(request.url, "http://local").pathname
    if (pathname.endsWith("/auth/login") && request.method === "POST") {
      loginAttempts++
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ access_token: "two", refresh_token: "refresh-two", usuario: user(2) }))
      return
    }
    if (pathname.endsWith("/auth/refresh") && request.method === "POST") {
      refreshCount++
      const chunks = []
      request.on("data", (chunk) => chunks.push(chunk))
      request.on("end", () => {
        const credential = JSON.parse(Buffer.concat(chunks).toString()).refresh_token
        if (!credential?.startsWith("refresh-")) { response.writeHead(401).end(JSON.stringify({ message: "Sessão revogada" })); return }
        response.setHeader("Content-Type", "application/json")
        const owner = credential.includes("two") ? "two" : "one"
        response.end(JSON.stringify({ access_token: owner, refresh_token: `refresh-${owner}-${refreshCount}` }))
      })
      return
    }
    const token = request.headers.authorization?.replace("Bearer ", "")
    if (!token || token === "expired") { response.writeHead(401).end(JSON.stringify({ message: "Sessão expirada" })); return }
    const id = token === "two" ? 2 : 1
    if (!["GET", "OPTIONS"].includes(request.method) && !pathname.endsWith("/tarefas/recorrencias/materializar")) domainMutations++
    response.setHeader("Content-Type", "application/json")
    if (pathname.endsWith("/auth/session")) response.end(JSON.stringify({ refresh_token: `refresh-${token}` }))
    else if (pathname.endsWith("/auth/logout")) response.end(JSON.stringify({ message: "ok" }))
    else if (pathname.endsWith("/usuarios/me")) response.end(JSON.stringify(user(id)))
    else if (pathname.endsWith("/orientacao")) response.end(JSON.stringify({ tarefas: [task(id, id)], direcoes: [], financeiro: null, falhas: {} }))
    else if (pathname.endsWith("/tarefas/recorrencias/materializar")) response.writeHead(204).end()
    else if (pathname.endsWith("/tarefas/foco")) response.end(JSON.stringify({ tasks: [task(id, id)], daily_tasks: [task(id, id)] }))
    else if (pathname.endsWith("/tarefas")) response.end(JSON.stringify([task(id, id)]))
    else if (pathname.endsWith("/objetivos")) response.end(JSON.stringify([{ id, titulo: `Objetivo ${id}`, status: "ativo", order_index: 0 }]))
    else if (pathname.endsWith("/acompanhamentos")) response.end(JSON.stringify([{ id, titulo: `Acompanhamento ${id}`, objetivo_id: id, ocorrencias: [] }]))
    else if (pathname.endsWith("/financas")) {
      const month = new URL(request.url, "http://local").searchParams.get("mes") || new Date().toISOString().slice(0, 7)
      response.end(JSON.stringify({ mes: month, moeda: "BRL", saldo_centavos: id * 100, resultado_centavos: id * 100, receitas_centavos: id * 100, despesas_centavos: 0, serie_diaria: [], lancamentos: [] }))
    } else response.writeHead(404).end(JSON.stringify({ message: "Não encontrado" }))
  })
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve))
  const apiPort = api.address().port
  const previewPort = await freePort()
  const profile = await mkdtemp(join(tmpdir(), "bunkermode-pwa-"))
  let preview, chrome, cdp
  try {
    await exec("npm", ["run", "build"], { cwd: process.cwd(), env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${apiPort}` }, maxBuffer: 5_000_000 })
    const manifest = JSON.parse(await readFile("dist/manifest.webmanifest", "utf8"))
    assert.equal(manifest.display, "standalone")
    assert.equal(manifest.scope, "/")
    assert.equal(manifest.lang, "pt-BR")
    preview = spawn("./node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"], { stdio: "ignore" })
    const origin = `http://127.0.0.1:${previewPort}`
    await until(async () => (await fetch(origin)).ok, "preview")
    for (const path of ["/sw.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/maskable-512.png"]) {
      const response = await fetch(origin + path)
      assert.equal(response.ok, true, path)
      assert.equal((await response.text()).startsWith("<!doctype html>"), false, path)
    }
    chrome = spawn(browser, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, origin], { stdio: "ignore" })
    await until(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).includes("/devtools"), "CDP")
    const [debugPort] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")
    let target
    await until(async () => {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = pages.find((page) => page.type === "page")
      return !!target
    }, "aba do navegador")
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }) })
    cdp = new CDP(socket)
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("Network.enable")
    const evaluate = (code) => cdp.evaluate(code)
    const navigate = async (path) => { await cdp.send("Page.navigate", { url: origin + path }); await until(() => evaluate("document.readyState === 'complete'"), `navegação ${path}`) }
    const visible = async (value) => {
      try { await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(value)})`), value) }
      catch (error) { throw new Error(`${error.message}; tela: ${await evaluate("document.body.innerText.slice(0, 500)")}`) }
    }
    await until(() => evaluate("navigator.serviceWorker.ready.then(r => r.active?.state === 'activated')"), "service worker ativo", 30000)
    assert.equal(await evaluate("(async () => { const names = await caches.keys(); const keys = (await Promise.all(names.map(async n => (await caches.open(n)).keys()))).flat().map(r => r.url); return keys.some(x => new URL(x).pathname === '/index.html') && !keys.some(x => x.includes('/api/v2/')); })()"), true)
    console.log("PWA: manifest, service worker e precache estático OK")

    await evaluate(`localStorage.setItem('bunkermode_token','one'); localStorage.setItem('bunkermode_usuario',${JSON.stringify(JSON.stringify(user(1)))})`)
    await navigate("/tarefas")
    await visible("Tarefa do usuário 1")
    await navigate("/objetivos")
    await visible("Objetivo 1")
    await navigate("/financas")
    await visible("1,00")
    await evaluate("document.querySelector('button[aria-label=\"Mês anterior\"]')?.click()")
    await until(() => evaluate("document.body.innerText.includes('Mês atual')"), "mês financeiro anterior")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1 && x.key.startsWith('finances:')).length>=2)})})()"), "snapshots de dois meses")
    await navigate("/")
    await visible("Tarefa do usuário 1")
    const stored = await evaluate("(async () => { const db = await new Promise((ok,no) => { const r=indexedDB.open('bunkermode-offline'); r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error) }); return await new Promise((ok,no) => { const r=db.transaction('snapshots').objectStore('snapshots').getAll(); r.onsuccess=()=>ok(r.result.map(x=>({ownerId:x.ownerId,key:x.key,updatedAt:x.updatedAt}))); r.onerror=()=>no(r.error) }) })()")
    assert(stored.some((item) => item.ownerId === 1 && item.key === "tasks:all" && item.updatedAt))
    assert(stored.every((item) => Number.isSafeInteger(item.ownerId) && !item.key.includes("one")))
    assert(stored.some((item) => item.ownerId === 1 && item.key.startsWith("finances:")))
    assert(stored.filter((item) => item.ownerId === 1 && item.key.startsWith("finances:")).length >= 2)
    assert.equal(await evaluate("(async()=>{const names=await caches.keys();const urls=(await Promise.all(names.map(async n=>(await caches.open(n)).keys()))).flat().map(x=>x.url);return urls.some(x=>x.includes('/api/v2/'))})()"), false)
    console.log("PWA: snapshots por usuário e domínio OK")

    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    for (const path of ["/", "/tarefas", "/tarefas/foco", "/objetivos", "/financas", "/configuracoes"]) {
      await navigate(path)
      await visible("API indisponível")
    }
    await navigate("/tarefas")
    await visible("Tarefa do usuário 1")
    await visible("Última atualização")
    const offlineTimestamp = await evaluate("(async () => { const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').get([1,'tasks:all']);r.onsuccess=()=>ok(r.result?.updatedAt)})})()")
    assert.equal(offlineTimestamp, stored.find((item) => item.ownerId === 1 && item.key === "tasks:all").updatedAt)
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    console.log("PWA: rotas profundas, sessão local e snapshots offline OK")

    await evaluate("localStorage.setItem('bunkermode_focus:1', JSON.stringify({activityText:'Foco local persistido',phase:'active',startedAt:Date.now(),endsAt:Date.now()+45*60000,durationMinutes:45}))")
    await navigate("/tarefas/foco")
    await visible("Foco local persistido")
    await navigate("/tarefas/foco")
    await visible("Foco local persistido")
    console.log("PWA: Foco local após reabertura OK")

    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await navigate("/tarefas")
    await visible("Tarefa do usuário 1")
    await evaluate("document.querySelector('button[aria-label=" + JSON.stringify("Sair") + "]')?.click()")
    await until(() => evaluate("location.pathname === '/auth'"), "logout")
    assert.equal(await evaluate("localStorage.getItem('bunkermode_focus:1')"), null)
    const remaining = await evaluate("(async () => { const db = await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1).length)})})()")
    assert.equal(remaining, 0)
    await evaluate(`localStorage.setItem('bunkermode_token','two'); localStorage.setItem('bunkermode_usuario',${JSON.stringify(JSON.stringify(user(2)))})`)
    await navigate("/tarefas")
    await visible("Tarefa do usuário 2")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa do usuário 1')"), false)
    console.log("PWA: logout e troca de usuário OK")

    const secret = "a".repeat(64)
    await navigate(`/reset-password#token=${secret}`)
    await until(() => evaluate("location.hash === ''"), "remoção do fragmento")
    assert.equal(await evaluate(`(async () => {const names=await caches.keys(); const urls=(await Promise.all(names.map(async n=>(await caches.open(n)).keys()))).flat().map(x=>x.url); return urls.some(x=>x.includes('${secret}'))})()`), false)
    assert.equal(await evaluate(`(async () => {const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(JSON.stringify(r.result).includes('${secret}'))})})()`), false)
    console.log("PWA: token de reset fora dos armazenamentos OK")

    await evaluate("window.__pwaMarker = 1; const input = document.querySelector('input[type=password]'); if (input) input.value = 'rascunho-local'")
    await appendFile("dist/sw.js", `\n// pwa-update-test-${Date.now()}\n`)
    await evaluate("navigator.serviceWorker.getRegistration().then(reg => reg.update())")
    await visible("Nova versão disponível")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Depois')?.click()")
    assert.equal(await evaluate("window.__pwaMarker === 1 && document.querySelector('input[type=password]')?.value === 'rascunho-local'"), true)
    assert.equal(await evaluate("navigator.serviceWorker.getRegistration().then(reg => reg.waiting?.state === 'installed')"), true)
    console.log("PWA: atualização adiada mantém formulário e worker waiting OK")

    await navigate("/tarefas")
    await visible("Tarefa do usuário 2")
    await until(() => evaluate("document.body.innerText.includes('Instale o BunkerMode')"), "convite de instalação")
    await evaluate("document.querySelector('button[aria-label=" + JSON.stringify("Fechar convite de instalação") + "]')?.click()")
    await evaluate("document.querySelector('a[href=\"/configuracoes\"]')?.click()")
    await until(() => evaluate("location.pathname === '/configuracoes'"), "navegação interna")
    assert.equal(await evaluate("document.body.innerText.includes('Instale o BunkerMode')"), false)
    console.log("PWA: convite dispensado não reaparece ao navegar OK")

    await navigate("/configuracoes")
    await visible("Nova versão disponível")
    await evaluate("window.__updateMarker = 1; [...document.querySelectorAll('button')].find(button => button.textContent === 'Atualizar')?.click()")
    await until(() => evaluate("navigator.serviceWorker.getRegistration().then(reg => !reg.waiting && reg.active?.state === 'activated')"), "ativação da atualização")
    await until(() => evaluate("window.__updateMarker !== 1"), "reload aprovado")
    console.log("PWA: atualização aprovada ativa o novo worker e recarrega OK")

    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await evaluate("(async () => {const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});const tx=db.transaction('snapshots','readwrite');const store=tx.objectStore('snapshots');const old=await new Promise(ok=>{const r=store.get([2,'tasks:all']);r.onsuccess=()=>ok(r.result)});store.put({...old,data:{corrompido:true}});await new Promise(ok=>{tx.oncomplete=ok})})()")
    await navigate("/tarefas")
    await visible("Tarefas")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa do usuário 2')"), false)
    console.log("PWA: snapshot corrompido não quebra o app offline OK")

    const mutationsBefore = domainMutations
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Nova tarefa'))?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Teste offline" })
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Registrar tarefa')?.click()")
    await visible("Esta ação exige conexão com a API")
    assert.equal(domainMutations, mutationsBefore)
    console.log("PWA: mutation de servidor bloqueada sem requisição offline OK")

    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeReconnect = refreshCount
    await navigate("/tarefas")
    await visible("API indisponível")
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("localStorage.getItem('bunkermode_token') === 'two'"), "refresh na reconexão")
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    assert.equal(refreshCount - refreshesBeforeReconnect, 1)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length>0)})})()"), true)
    console.log("PWA: access expirado renova na reconexão sem sair da rota OK")

    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeReopen = refreshCount
    const credentialBeforeReopen = await evaluate("localStorage.getItem('bunkermode_refresh_token')")
    await navigate("/tarefas")
    await until(() => evaluate("localStorage.getItem('bunkermode_token') === 'two'"), "refresh ao reabrir")
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    assert.equal(refreshCount - refreshesBeforeReopen, 1)
    assert.notEqual(await evaluate("localStorage.getItem('bunkermode_refresh_token')"), credentialBeforeReopen)
    console.log("PWA: reabertura com access expirado restaura rota e sessão OK")

    await evaluate("localStorage.setItem('bunkermode_refresh_token','revoked'); localStorage.setItem('bunkermode_token','expired')")
    await navigate("/tarefas")
    await until(() => evaluate("location.pathname === '/auth'"), "refresh revogado")
    assert.equal(await evaluate("localStorage.getItem('bunkermode_refresh_token')"), null)
    console.log("PWA: refresh revogado encerra sessão OK")

    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await navigate("/auth")
    await visible("Entrar no Bunker")
    await navigate(`/reset-password#token=${secret}`)
    await until(() => evaluate("location.hash === ''"), "reset offline sem fragmento")
    console.log("PWA: autenticação e reset abrem pelo shell offline OK")

    await cdp.send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", platform: "iPhone" })
    await navigate("/auth")
    await visible("Instale o BunkerMode")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Instalar')?.click()")
    await visible("Compartilhar")
    await visible("Adicionar à Tela de Início")
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] })
    await navigate("/auth")
    if (await evaluate("window.matchMedia('(display-mode: standalone)').matches")) {
      assert.equal(await evaluate("document.body.innerText.includes('Instale o BunkerMode')"), false)
      console.log("PWA: instrução iOS e ausência do convite em standalone OK")
    } else console.log("PWA: instrução iOS OK; display-mode standalone requer validação no dispositivo")

    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await evaluate("document.querySelector('input[name=identificador]')?.focus()")
    await cdp.send("Input.insertText", { text: "pwa-2" })
    await evaluate("document.querySelector('input[name=senha]')?.focus()")
    await cdp.send("Input.insertText", { text: "senha123" })
    await evaluate("document.querySelector('button[type=submit]')?.click()")
    await until(() => evaluate("location.pathname === '/'"), "login após reconexão")
    assert.equal(loginAttempts, 1)
    assert.equal(await evaluate("localStorage.getItem('bunkermode_token')"), "two")
    console.log("PWA: login após reconexão confirma API sem health check OK")
  } finally {
    cdp?.close()
    chrome?.kill("SIGTERM")
    preview?.kill("SIGTERM")
    await new Promise((resolve) => api.close(resolve))
    if (chrome?.exitCode === null) await Promise.race([once(chrome, "exit"), delay(2000)])
    await until(async () => { try { await rm(profile, { recursive: true, force: true }); return true } catch { return false } }, "limpeza do perfil", 5000)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
