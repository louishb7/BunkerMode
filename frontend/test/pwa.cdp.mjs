import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:http"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  close() { this.socket.close() }
}

async function main() {
  const browser = "/usr/bin/brave-browser"
  let domainMutations = 0
  let loginAttempts = 0
  let refreshCount = 0
  let syncCalls = 0
  const syncTokens = []
  const processed = new Map()
  const forcedStatuses = new Map()
  let lostResponse = false
  let syncDelayMs = 0
  let backendFailure = null
  const tasksByOwner = new Map([[1, [task(1, 1)]], [2, [task(2, 2)]]])
  const goalsByOwner = new Map([[1, [{ id: 1, titulo: "Objetivo 1", status: "ativo", order_index: 0, updated_at: new Date().toISOString() }]], [2, [{ id: 2, titulo: "Objetivo 2", status: "ativo", order_index: 0, updated_at: new Date().toISOString() }]]])
  const trackersByOwner = new Map([[1, [{ id: 1, titulo: "Acompanhamento 1", objetivo_id: 1, ocorrencias: [], updated_at: new Date().toISOString() }]], [2, [{ id: 2, titulo: "Acompanhamento 2", objetivo_id: 2, ocorrencias: [], updated_at: new Date().toISOString() }]]])
  const entriesByOwner = new Map([[1, []], [2, []]])
  const appliedOrder = []
  let nextTaskId = 3
  let nextGoalId = 3, nextTrackerId = 3, nextOccurrenceId = 1, nextEntryId = 1, nextSeriesId = 1
  const api = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return }
    const pathname = new URL(request.url, "http://local").pathname
    if (backendFailure === "network") { response.destroy(); return }
    if (backendFailure === 503) { response.writeHead(503).end(JSON.stringify({ message: "Serviço temporariamente indisponível" })); return }
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
    if (pathname.endsWith("/offline/operations") && request.method === "POST") {
      syncCalls++
      syncTokens.push(token)
      const chunks = []
      request.on("data", (chunk) => chunks.push(chunk))
      request.on("end", () => {
        const operation = JSON.parse(Buffer.concat(chunks).toString())
        const forced = forcedStatuses.get(operation.payload?.titulo)
        if (forced) { if (forced === 503) backendFailure = 503; response.writeHead(forced).end(JSON.stringify({ message: "Falha de teste sem credenciais" })); return }
        const key = `${id}:${operation.operationId}`
        if (!processed.has(key)) {
          if (operation.domain === "task" && operation.action === "create") {
            if (operation.payload.objetivo_id != null && !goalsByOwner.get(id).some((goal) => goal.id === operation.payload.objetivo_id)) {
              response.writeHead(400).end(JSON.stringify({ message: "Objetivo inválido" })); return
            }
            const created = { ...task(nextTaskId++, id), ...operation.payload, id: nextTaskId - 1,
              status: "PENDENTE", status_code: "PENDENTE", status_label: "Pendente",
              updated_at: new Date().toISOString(),
              recurrence: operation.payload.recurrence_weekdays?.length
                ? { series_id: nextSeriesId++, weekdays: operation.payload.recurrence_weekdays,
                    termination_policy: operation.payload.duration_type, end_date: operation.payload.recurrence_end_date ?? null }
                : null }
            tasksByOwner.get(id).push(created)
            processed.set(key, created)
          } else if (operation.domain === "task" && operation.action === "delete") {
            const current = tasksByOwner.get(id).find(item => item.id === operation.target)
            if (!current || current.status !== "PENDENTE") { response.writeHead(400).end(JSON.stringify({ message: "Tarefa não pode ser excluída" })); return }
            const series = current.recurrence?.series_id
            tasksByOwner.set(id, tasksByOwner.get(id).filter(item => series
              ? item.recurrence?.series_id !== series || item.status === "CONCLUIDA"
              : item.id !== operation.target))
            processed.set(key, { deleted: true })
          } else if (operation.domain === "task" && operation.action === "update") {
            const current = tasksByOwner.get(id).find((item) => item.id === operation.target)
            if (!current) { response.writeHead(404).end(JSON.stringify({ message: "Tarefa ausente" })); return }
            Object.assign(current, operation.payload, { updated_at: new Date().toISOString() })
            processed.set(key, current)
          } else if (operation.domain === "task" && operation.action === "complete") {
            const current = tasksByOwner.get(id).find((item) => item.id === operation.target)
            if (!current) { response.writeHead(404).end(JSON.stringify({ message: "Tarefa ausente" })); return }
            Object.assign(current, { status: "CONCLUIDA", status_code: "CONCLUIDA", status_label: "Concluída", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            processed.set(key, current)
          } else if (operation.domain === "goal" && operation.action === "create") {
            const created = { id: nextGoalId++, usuario_id: id, titulo: operation.payload.titulo, descricao: operation.payload.descricao ?? null,
              data_alvo: operation.payload.data_alvo ?? null, status: "ativo", order_index: goalsByOwner.get(id).length,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(), concluded_at: null }
            goalsByOwner.get(id).push(created)
            processed.set(key, created)
          } else if (operation.domain === "goal" && operation.action === "delete") {
            const goals = goalsByOwner.get(id)
            const index = goals.findIndex((goal) => goal.id === operation.target)
            if (index < 0) { response.writeHead(404).end(JSON.stringify({ message: "Objetivo ausente" })); return }
            goals.splice(index, 1)
            for (const item of tasksByOwner.get(id)) if (item.objetivo_id === operation.target) item.objetivo_id = null
            for (const item of trackersByOwner.get(id)) if (item.objetivo_id === operation.target) item.objetivo_id = null
            processed.set(key, { deleted: true })
          } else if (operation.domain === "tracker" && operation.action === "create") {
            if (operation.payload.objetivo_id != null && !goalsByOwner.get(id).some((goal) => goal.id === operation.payload.objetivo_id)) {
              response.writeHead(400).end(JSON.stringify({ message: "Objetivo inválido" })); return
            }
            const created = { id: nextTrackerId++, usuario_id: id, titulo: operation.payload.titulo,
              descricao: operation.payload.descricao ?? null, objetivo_id: operation.payload.objetivo_id ?? null,
              intent: operation.payload.intent ?? "registro_livre", status: "ativo",
              planos: operation.payload.plan ? [{ ...operation.payload.plan, effective_until: null, paused: false }] : [],
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ocorrencias: [] }
            trackersByOwner.get(id).push(created)
            processed.set(key, created)
          } else if (operation.domain === "occurrence" && operation.action === "create") {
            const parent = trackersByOwner.get(id).find((item) => item.id === operation.parentId)
            if (!parent) { response.writeHead(400).end(JSON.stringify({ message: "Acompanhamento inválido" })); return }
            const occurred = operation.payload.occurred_at ?? new Date().toISOString()
            const day = occurred.slice(0,10)
            const plan = [...(parent.planos ?? [])].reverse().find(item => item.effective_from <= day && (!item.effective_until || day < item.effective_until))
            const created = { id: nextOccurrenceId++, acompanhamento_id: parent.id, occurred_at: occurred,
              created_at: new Date().toISOString(), recorded_at: operation.payload.recorded_at ?? null,
              kind: operation.payload.kind ?? (parent.intent === "repetir" ? "atividade" : "ocorrencia"),
              amount: operation.payload.amount ?? null, unit: plan?.unit ?? null, note: operation.payload.note ?? null }
            parent.ocorrencias.push(created)
            processed.set(key, created)
          } else if (operation.domain === "tracker" && operation.action === "update") {
            const parent = trackersByOwner.get(id).find(item => item.id === operation.target)
            if (!parent) { response.writeHead(404).end(JSON.stringify({message:"Comportamento ausente"})); return }
            const { plan, effective_from, recorded_at, ...fields } = operation.payload
            Object.assign(parent, fields)
            if (plan || fields.status) {
              const previous = parent.planos.at(-1)
              const next = plan ? {...plan,paused:fields.status ? fields.status === "pausado" : previous.paused}
                : {...previous,effective_from,paused:fields.status === "pausado"}
              previous.effective_until = next.effective_from
              parent.planos.push({...next,effective_until:null})
            }
            parent.updated_at = new Date().toISOString()
            processed.set(key,parent)
          } else if (operation.domain === "entry" && operation.action === "create") {
            if (!Number.isSafeInteger(operation.payload.valor_centavos)) { response.writeHead(400).end(JSON.stringify({ message: "Centavos inválidos" })); return }
            const created = { id: nextEntryId++, usuario_id: id, ...operation.payload }
            entriesByOwner.get(id).push(created)
            processed.set(key, created)
          } else { response.writeHead(400).end(JSON.stringify({ message: "Operação de teste desconhecida" })); return }
          appliedOrder.push({ domain: operation.domain, action: operation.action, target: operation.target, parentId: operation.parentId, payload: operation.payload })
        }
        if (operation.payload?.titulo === "Resposta perdida" && !lostResponse) {
          lostResponse = true
          backendFailure = "network"
          response.destroy()
        } else {
          const reply = () => response.writeHead(201).end(JSON.stringify(processed.get(key)))
          if (syncDelayMs) setTimeout(reply, syncDelayMs)
          else reply()
        }
      })
      return
    }
    if (pathname.endsWith("/auth/session")) response.end(JSON.stringify({ refresh_token: `refresh-${token}` }))
    else if (pathname.endsWith("/auth/logout")) response.end(JSON.stringify({ message: "ok" }))
    else if (pathname.endsWith("/usuarios/me")) response.end(JSON.stringify(user(id)))
    else if (pathname.endsWith("/orientacao")) response.end(JSON.stringify({ tarefas: tasksByOwner.get(id).filter((item) => item.status !== "CONCLUIDA").slice(0, 3), direcoes: [], financeiro: null, falhas: {} }))
    else if (pathname.endsWith("/tarefas/recorrencias/materializar")) response.writeHead(204).end()
    else if (pathname.endsWith("/tarefas/foco")) response.end(JSON.stringify({ tasks: tasksByOwner.get(id), daily_tasks: tasksByOwner.get(id) }))
    else if (pathname.endsWith("/tarefas")) response.end(JSON.stringify(tasksByOwner.get(id)))
    else if (pathname.endsWith("/objetivos")) response.end(JSON.stringify(goalsByOwner.get(id)))
    else if (pathname.endsWith("/acompanhamentos")) response.end(JSON.stringify(trackersByOwner.get(id)))
    else if (pathname.endsWith("/financas")) {
      const month = new URL(request.url, "http://local").searchParams.get("mes") || new Date().toISOString().slice(0, 7)
      const history = entriesByOwner.get(id)
      const entries = history.filter((item) => item.data.slice(0, 7) === month)
      const balance = history.reduce((sum, item) => sum + (["receita", "ajuste_entrada"].includes(item.tipo) ? 1 : -1) * item.valor_centavos, 0)
      const incoming = entries.filter((item) => item.tipo === "receita").reduce((sum, item) => sum + item.valor_centavos, 0)
      const outgoing = entries.filter((item) => item.tipo === "despesa").reduce((sum, item) => sum + item.valor_centavos, 0)
      const daily = Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() }, (_, index) => {
        const day = `${month}-${String(index + 1).padStart(2, '0')}`
        const incomes = entries.filter((item) => item.tipo === 'receita' && item.data <= day).reduce((sum, item) => sum + item.valor_centavos, 0)
        const expenses = entries.filter((item) => item.tipo === 'despesa' && item.data <= day).reduce((sum, item) => sum + item.valor_centavos, 0)
        return { data: day, receitas_centavos: incomes, despesas_centavos: expenses, resultado_centavos: incomes - expenses }
      })
      response.end(JSON.stringify({ mes: month, moeda: "BRL", saldo_centavos: id * 100 + balance,
        resultado_centavos: incoming - outgoing, receitas_centavos: incoming,
        despesas_centavos: outgoing, serie_diaria: daily, lancamentos: history }))
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
    let confirmDecision = false
    let dialogCount = 0
    socket.addEventListener("message", ({ data }) => {
      const event = JSON.parse(data)
      if (event.method === "Page.javascriptDialogOpening") {
        dialogCount++
        void cdp.send("Page.handleJavaScriptDialog", { accept: confirmDecision })
      }
    })
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("Network.enable")
    const evaluate = (code) => cdp.evaluate(code)
    // Mantém o estado do navegador após navegações atendidas pelo service worker.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => sessionStorage.getItem('pwa-test-offline') !== 'true' })
    ` })
    const setConnectivity = async (connected) => {
      await evaluate(`sessionStorage.setItem('pwa-test-offline', ${JSON.stringify(String(!connected))})`)
      await cdp.send("Network.emulateNetworkConditions", {
        offline: !connected, latency: 0,
        downloadThroughput: connected ? -1 : 0, uploadThroughput: connected ? -1 : 0,
      })
    }
    const navigate = async (path) => { await cdp.send("Page.navigate", { url: origin + path }); await until(() => evaluate("document.readyState === 'complete'"), `navegação ${path}`) }
    const visible = async (value) => {
      try { await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(value)})`), value) }
      catch (error) { throw new Error(`${error.message}; tela: ${await evaluate("document.body.innerText.slice(0, 500)")}`) }
    }
    const auditLayout = async (surface) => {
      for (const theme of ["light", "dark"]) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        for (const width of [1440, 1024, 768, 390, 320]) {
          await cdp.send("Emulation.setDeviceMetricsOverride", {width, height:900, deviceScaleFactor:1, mobile:width<=390})
          await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
          assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,`${surface} ${theme} ${width}px`)
          if (process.env.BUNKER_AUDIT_DIR && [1440,390].includes(width)) {
            const shot = await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})
            await writeFile(join(process.env.BUNKER_AUDIT_DIR,`${surface}-${theme}-${width}.png`),Buffer.from(shot.data,"base64"))
          }
        }
      }
      await cdp.send("Emulation.clearDeviceMetricsOverride")
      await evaluate("document.documentElement.removeAttribute('data-theme')")
    }
    const putOutbox = async (operation) => evaluate(`(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put(${JSON.stringify(operation)});await new Promise(ok=>tx.oncomplete=ok);window.dispatchEvent(new CustomEvent('bunkermode-outbox-change',{detail:2}))})()`)
    const outboxStatus = async (operationId) => evaluate(`(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').get([2,${JSON.stringify(operationId)}]);r.onsuccess=()=>ok(r.result?.status??null)})})()`)
    await until(() => evaluate("navigator.serviceWorker.ready.then(r => r.active?.state === 'activated')"), "service worker ativo", 30000)
    assert.equal(await evaluate("(async () => { const names = await caches.keys(); const keys = (await Promise.all(names.map(async n => (await caches.open(n)).keys()))).flat().map(r => r.url); return keys.some(x => new URL(x).pathname === '/index.html') && !keys.some(x => x.includes('/api/v2/')); })()"), true)
    console.log("PWA: manifest, service worker e precache estático OK")

    await evaluate("(async()=>{const db=await new Promise((ok,fail)=>{const r=indexedDB.open('bunkermode-offline',2);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('snapshots',{keyPath:['ownerId','key']});s.createIndex('ownerId','ownerId');const o=r.result.createObjectStore('outbox',{keyPath:['ownerId','operationId']});o.createIndex('ownerId','ownerId')};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error)});const tx=db.transaction(['snapshots','outbox'],'readwrite');tx.objectStore('snapshots').put({ownerId:99,key:'legacy:test',data:{preservado:true},updatedAt:new Date().toISOString(),schemaVersion:1});tx.objectStore('snapshots').put({ownerId:99,key:'reserves',data:[],updatedAt:new Date().toISOString(),schemaVersion:1});tx.objectStore('snapshots').put({ownerId:99,key:'finances:2026-01',data:{lancamentos:[{categoria:'Outros'}]},updatedAt:new Date().toISOString(),schemaVersion:1});tx.objectStore('outbox').put({ownerId:99,operationId:'legacy-reserve',domain:'reserve',action:'create',payload:{titulo:'Legado'},createdAt:new Date().toISOString(),status:'pending'});await new Promise(ok=>tx.oncomplete=ok);db.close()})()")
    await evaluate(`localStorage.setItem('bunkermode_token','one'); localStorage.setItem('bunkermode_usuario',${JSON.stringify(JSON.stringify(user(1)))})`)
    await navigate("/tarefas")
    await visible("Tarefa do usuário 1")
    assert.equal(await evaluate("navigator.onLine"), true)
    assert.equal(await evaluate("document.body.innerText.includes('Aguardando sincronização')"), false)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').get([99,'legacy:test']);r.onsuccess=()=>ok(db.version===3 && db.objectStoreNames.contains('outbox') && r.result?.data?.preservado===true)})})()"), true)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});const read=(store,key)=>new Promise(ok=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>ok(r.result)});return !(await read('snapshots',[99,'reserves'])) && !(await read('outbox',[99,'legacy-reserve'])) && !('categoria' in (await read('snapshots',[99,'finances:2026-01'])).data.lancamentos[0])})()"), true)
    console.log("PWA: upgrade IndexedDB v2→v3 remove reservas e categorias e preserva os demais snapshots OK")
    await navigate("/objetivos")
    await visible("Objetivo 1")
    const mapTasks = Array.from({ length: 6 }, (_, index) => ({ ...task(1000 + index, 1),
      titulo: `Contribuição ${index + 1} com título longo para conferir a árvore`, objetivo_id: 1 }))
    tasksByOwner.get(1).push(...mapTasks)
    await navigate("/objetivos")
    await until(() => evaluate("document.querySelectorAll('.map-line').length === 7"), "linhas na primeira montagem real")
    assert.equal(await evaluate("document.querySelector('.objective-workspace').innerText.includes('Nenhuma tarefa prevista')"), false)
    assert.equal(await evaluate("document.querySelector('.map-root').innerText.includes('Conquistar objetivo')"), false)
    await evaluate("document.querySelector('.map-expand')?.click()")
    await until(() => evaluate("document.querySelectorAll('.map-line').length === 9"), "expansão real da árvore")
    await evaluate("document.querySelector('.map-expand')?.click()")
    const desktopPath = await evaluate("document.querySelector('.map-line').getAttribute('d')")
    for (const width of [1440, 980, 760, 390]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
      await until(() => evaluate("document.querySelectorAll('.map-line').length === 7"), "conexões após resize")
      assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `árvore em ${width}px`)
      if (width === 390) {
        await until(() => evaluate("!document.querySelector('.map-line').getAttribute('d').includes(' C ')"), "árvore vertical mobile")
        assert.notEqual(await evaluate("document.querySelector('.map-line').getAttribute('d')"), desktopPath)
      }
    }
    await evaluate("document.querySelector('.objective-canvas').style.display='none'")
    await until(() => evaluate("document.querySelectorAll('.map-line').length === 0"), "árvore oculta")
    await evaluate("document.querySelector('.objective-canvas').style.display=''")
    await until(() => evaluate("document.querySelectorAll('.map-line').length === 7"), "árvore reexibida")
    await evaluate("document.querySelector('[aria-label=\"Ações do objetivo: Objetivo 1\"]').click()")
    assert.equal(await evaluate("[...document.querySelectorAll('[role=menuitem]')].some(x=>x.innerText==='Conquistar objetivo')"), true)
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" })
    await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Adicionar vínculo').focus()")
    await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Adicionar vínculo').click()")
    assert.equal(await evaluate("document.querySelector('[role=dialog] input')"), null)
    await evaluate("[...document.querySelectorAll('.composer-choice')].find(x=>x.innerText.includes('Tarefa')).click()")
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(x=>x.innerText==='Vincular tarefa existente').click()")
    assert.equal(await evaluate("document.querySelector('.composer-results')"), null)
    await evaluate("document.querySelector('[aria-label=\"Pesquisar tarefas\"]').focus()")
    for (const character of ['T', 'a', 'r']) {
      await cdp.send("Input.insertText", { text: character })
      assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), "Pesquisar tarefas")
    }
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Pesquisar tarefas\"]').value"), "Tar")
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" })
    await until(() => evaluate("!document.querySelector('[role=dialog]')"), "saída do seletor mobile")
    assert.equal(await evaluate("document.activeElement.innerText"), "Adicionar vínculo")
    if (process.env.BUNKER_AUDIT_DIR) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
      await writeFile(join(process.env.BUNKER_AUDIT_DIR, "objectives-mobile.png"), Buffer.from(shot.data, "base64"))
    }
    await cdp.send("Emulation.clearDeviceMetricsOverride")
    tasksByOwner.set(1, tasksByOwner.get(1).filter(x => x.id < 1000))
    console.log("Produto Gate 2: árvore inicial, expansão, resize, ocultação, menu de conquista, busca/foco e saída mobile OK")
    if (process.env.BUNKER_GATE === "2") return
    await navigate("/financas")
    await visible("1,00")
    await evaluate("document.querySelector('button[aria-label=\"Mês anterior\"]')?.click()")
    await until(() => evaluate("document.body.innerText.includes('Mês atual')"), "mês financeiro anterior")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1 && x.key.startsWith('finances:')).length>=2)})})()"), "snapshots de dois meses")
    await navigate("/")
    await visible("Tarefa do usuário 1")
    await auditLayout("home")
    console.log("Auditoria integrada: Home compacta, 320–1440px, light/dark e transição da navegação OK")
    const stored = await evaluate("(async () => { const db = await new Promise((ok,no) => { const r=indexedDB.open('bunkermode-offline'); r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error) }); return await new Promise((ok,no) => { const r=db.transaction('snapshots').objectStore('snapshots').getAll(); r.onsuccess=()=>ok(r.result.map(x=>({ownerId:x.ownerId,key:x.key,updatedAt:x.updatedAt}))); r.onerror=()=>no(r.error) }) })()")
    assert(stored.some((item) => item.ownerId === 1 && item.key === "tasks:all" && item.updatedAt))
    assert(stored.every((item) => Number.isSafeInteger(item.ownerId) && !item.key.includes("one")))
    assert(stored.some((item) => item.ownerId === 1 && item.key.startsWith("finances:")))
    assert(stored.filter((item) => item.ownerId === 1 && item.key.startsWith("finances:")).length >= 2)
    assert.equal(await evaluate("(async()=>{const names=await caches.keys();const urls=(await Promise.all(names.map(async n=>(await caches.open(n)).keys()))).flat().map(x=>x.url);return urls.some(x=>x.includes('/api/v2/'))})()"), false)
    console.log("PWA: snapshots por usuário e domínio OK")

    await setConnectivity(false)
    await visible("Sem conexão")
    assert.equal(await evaluate("navigator.onLine"), false)
    for (const path of ["/", "/tarefas", "/tarefas/foco", "/objetivos", "/financas", "/configuracoes"]) {
      await navigate(path)
      await visible("Bunker")
      assert.equal(await evaluate("document.querySelector('[data-sync-status]').dataset.syncStatus"), "offline")
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

    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("!document.body.innerText.includes('Aguardando sincronização')"), "aviso removido na reconexão")
    await navigate("/tarefas")
    await visible("Tarefa do usuário 1")
    await setConnectivity(false)
    await evaluate("window.dispatchEvent(new Event('offline'))")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Nova tarefa'))?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Pendência privada de A" })
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Registrar tarefa')?.click()")
    await visible("Pendência privada de A")
    await evaluate("document.querySelector('button[aria-label=" + JSON.stringify("Sair") + "]')?.click()")
    await until(() => dialogCount === 1, "confirmação de pendência")
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1).length===1)})})()"), true)
    confirmDecision = true
    await evaluate("document.querySelector('button[aria-label=" + JSON.stringify("Sair") + "]')?.click()")
    await until(() => dialogCount === 2, "descarte consciente")
    await until(() => evaluate("location.pathname === '/auth'"), "logout")
    assert.equal(await evaluate("localStorage.getItem('bunkermode_focus:1')"), null)
    const remaining = await evaluate("(async () => { const db = await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1).length)})})()")
    assert.equal(remaining, 0)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===1).length===0)})})()"), true)
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await evaluate(`localStorage.setItem('bunkermode_token','two'); localStorage.setItem('bunkermode_usuario',${JSON.stringify(JSON.stringify(user(2)))})`)
    await navigate("/tarefas")
    await visible("Tarefa do usuário 2")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa do usuário 1')"), false)
    console.log("PWA: logout com pendência exige confirmação e isola troca de usuário OK")

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
    assert.equal(await evaluate("document.body.innerText.includes('Instale o BunkerMode')"), false, "desktop não recebe CTA próprio")
    await evaluate("document.querySelector('a[href=\"/configuracoes\"]')?.click()")
    await until(() => evaluate("location.pathname === '/configuracoes'"), "navegação interna")
    assert.equal(await evaluate("document.body.innerText.includes('Instale o BunkerMode')"), false)
    console.log("PWA: desktop preserva instalação nativa sem convite próprio em navegação OK")

    await navigate("/configuracoes")
    await visible("Nova versão disponível")
    await evaluate("window.__updateMarker = 1; [...document.querySelectorAll('button')].find(button => button.textContent === 'Atualizar')?.click()")
    await until(() => evaluate("navigator.serviceWorker.getRegistration().then(reg => !reg.waiting && reg.active?.state === 'activated')"), "ativação da atualização")
    await until(() => evaluate("window.__updateMarker !== 1"), "reload aprovado")
    console.log("PWA: atualização aprovada ativa o novo worker e recarrega OK")

    await setConnectivity(false)
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
    await visible("Sem conexão")
    assert.equal(domainMutations, mutationsBefore)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.length===1 && r.result[0].ownerId===2 && r.result[0].domain==='task')})})()"), true)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(!/refresh-two|Bearer |Authorization|bunkermode_token/.test(JSON.stringify(r.result)))})})()"), true)
    await navigate("/tarefas")
    await visible("Teste offline")
    console.log("PWA: tarefa local e outbox persistem após reabertura sem POST offline OK")

    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeReconnect = refreshCount
    await navigate("/tarefas")
    await visible("Sem conexão")
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("localStorage.getItem('bunkermode_token') === 'two'"), "refresh na reconexão")
    await until(() => syncCalls === 1, "sync após refresh")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.length===0)})})()"), "outbox vazia")
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    assert.equal(refreshCount - refreshesBeforeReconnect, 1)
    assert.deepEqual(syncTokens, ["two"])
    assert.equal(tasksByOwner.get(2).filter((item) => item.titulo === "Teste offline").length, 1)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length>0)})})()"), true)
    console.log("PWA: access expirado renova na reconexão sem sair da rota OK")

    const callsBeforeLostResponse = syncCalls
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Nova tarefa'))?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Resposta perdida" })
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Registrar tarefa')?.click()")
    await until(() => syncCalls >= callsBeforeLostResponse + 1, "primeiro envio da operação")
    await visible("Resposta perdida")
    await visible("Serviço temporariamente indisponível")
    assert.equal(await evaluate("document.querySelectorAll('[data-sync-status]').length"), 1)
    backendFailure = null
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => syncCalls >= callsBeforeLostResponse + 2, "replay da mesma operação")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.length===0)})})()"), "reconciliação do replay")
    assert.equal(tasksByOwner.get(2).filter((item) => item.titulo === "Resposta perdida").length, 1)
    console.log("PWA: resposta perdida é repetida com a mesma operação sem duplicar tarefa OK")

    // A/B: observa também o intervalo em que a projeção já mudou e o POST ainda responde.
    syncDelayMs = 700
    const assertQuietSync = async () => {
      assert.equal(await evaluate("document.querySelector('[data-sync-status]')"), null)
      assert.equal(await evaluate("/Aguardando sincronização|Alteração salva neste dispositivo|alterações? locais|API indisponível|Sincronizando/.test(document.body.innerText)"), false)
    }
    await evaluate(`window.syncNoise = []; window.syncObserver = new MutationObserver(() => {
      if (/Aguardando sincronização|Alteração salva neste dispositivo|alterações? locais|API indisponível/.test(document.body.innerText)) window.syncNoise.push(document.body.innerText)
    }); window.syncObserver.observe(document.body, {subtree:true, childList:true, characterData:true})`)
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Nova tarefa'))?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Criação online silenciosa" })
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Registrar tarefa')?.click()")
    await visible("Criação online silenciosa")
    await assertQuietSync()
    await until(() => tasksByOwner.get(2).some(t => t.titulo === "Criação online silenciosa"), "criação online enviada")
    await until(() => evaluate("!document.querySelector('[aria-label=\"Sincronização\"]')"), "criação online reconciliada")
    await evaluate("document.querySelector('button[aria-label=\"Ações da tarefa: Criação online silenciosa\"]')?.click()")
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.includes('Editar'))?.click()")
    await visible("Salvar edição")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: " editada" })
    await evaluate("document.querySelector('[role=dialog] button[type=submit]')?.click()")
    await visible("Criação online silenciosa editada")
    await assertQuietSync()
    await until(() => evaluate("!document.querySelector('[aria-label=\"Sincronização\"]')"), "edição reconciliada")
    await evaluate("document.querySelector('button[aria-label=\"Concluir: Criação online silenciosa editada\"]')?.click()")
    await assertQuietSync()
    await until(() => tasksByOwner.get(2).find(t => t.titulo === "Criação online silenciosa editada")?.status === "CONCLUIDA", "conclusão enviada")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "conclusão reconciliada")
    assert.deepEqual(await evaluate("window.syncNoise"), [])
    await evaluate("window.syncObserver.disconnect()")
    console.log("PWA UX A/B: criação, edição e conclusão online silenciosas durante replay OK")

    // F: persiste uma pendência antes de reabrir online; recuperação sem aviso de offline.
    const onlineReloadId = crypto.randomUUID()
    await putOutbox({ ownerId: 2, operationId: onlineReloadId, domain: "task", action: "create",
      payload: { titulo: "Reload online pendente", prazo: today }, createdAt: new Date().toISOString(), status: "pending" })
    await navigate("/tarefas")
    await visible("Reload online pendente")
    await assertQuietSync()
    await until(() => outboxStatus(onlineReloadId).then(status => status === null), "reload online reconciliado")
    await assertQuietSync()
    syncDelayMs = 0
    console.log("PWA UX F: reload online recupera outbox sem texto técnico OK")


    await setConnectivity(false)
    await navigate("/objetivos")
    await visible("Novo objetivo")
    const callsBeforeDependencies = syncCalls
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Novo objetivo')?.click()")
    await visible("Criar objetivo")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Meta local" })
    await evaluate("document.querySelector('form button[type=submit]')?.click()")
    await visible("Meta local")
    await evaluate("[...document.querySelectorAll('button.objective-rail-item')].find(button => button.textContent.includes('Meta local'))?.click()")
    await visible("Sem conexão")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Adicionar vínculo'))?.click()")
    await evaluate("[...document.querySelectorAll('.composer-choice')].find(x=>x.innerText.includes('Tarefa')).click()")
    await visible("Criar tarefa")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Criar tarefa')?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Tarefa ligada" })
    await evaluate("document.querySelector('select[name=\"repeat_type\"]').value='todos_dias'; document.querySelector('select[name=\"repeat_type\"]').dispatchEvent(new Event('change',{bubbles:true}))")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Registrar tarefa')?.click()")
    await visible("Tarefa ligada")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Adicionar vínculo'))?.click()")
    await evaluate("[...document.querySelectorAll('.composer-choice')].find(x=>x.innerText.includes('Comportamento')).click()")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Criar comportamento'))?.click()")
    await visible("Adicionar comportamento")
    await evaluate("document.querySelector('select[name=\"intent\"]').value='registro_livre'; document.querySelector('select[name=\"intent\"]').dispatchEvent(new Event('change',{bubbles:true}))")
    await evaluate("document.querySelector('[role=dialog] input')?.focus()")
    await cdp.send("Input.insertText", { text: "Tracker local" })
    await evaluate("document.querySelector('[role=dialog] form button[type=submit]')?.click()")
    await visible("Tracker local")
    await evaluate("[...document.querySelectorAll('.map-node')].find(x=>x.innerText.includes('Tracker local')).click()")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Registrar ocorrência')?.click()")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===4)})})()"), "quatro operações dependentes")
    assert.equal(syncCalls, callsBeforeDependencies)
    assert.equal(await evaluate("document.querySelectorAll('[data-sync-status]').length"), 1)
    assert.equal(await evaluate("document.body.innerText.includes('4 alterações locais')"), false)
    assert.equal(await evaluate("[...document.querySelectorAll('[aria-label=\"Sincronização\"] summary')].every(s => !s.innerText.trim())"), true)
    await navigate("/objetivos")
    await visible("Meta local")
    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeDependencies = refreshCount
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "dependências sincronizadas")
    assert.equal(refreshCount - refreshesBeforeDependencies, 1)
    assert.deepEqual(appliedOrder.slice(-4).map((item) => item.domain), ["goal", "task", "tracker", "occurrence"])
    const linkedGoal = goalsByOwner.get(2).find((item) => item.titulo === "Meta local")
    assert.equal(tasksByOwner.get(2).find((item) => item.titulo === "Tarefa ligada").objetivo_id, linkedGoal.id)
    assert.equal(trackersByOwner.get(2).find((item) => item.titulo === "Tracker local").objetivo_id, linkedGoal.id)
    assert.equal(trackersByOwner.get(2).find((item) => item.titulo === "Tracker local").ocorrencias.length, 1)
    console.log("PWA: objetivo, tarefa, acompanhamento e ocorrência dependentes sincronizam em ordem após refresh OK")

    await navigate("/objetivos#habitos")
    await visible("Novo comportamento")
    await setConnectivity(false)
    await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText==='Novo comportamento').click()")
    assert.equal(await evaluate("document.querySelector('select[name=objetivo_id]').value"), "")
    await evaluate("document.querySelector('input[name=titulo]').focus()")
    await cdp.send("Input.insertText", {text:"Ler 30 páginas"})
    await evaluate("document.querySelector('input[type=checkbox]').click()")
    await evaluate("document.querySelector('input[name=target_amount]').focus()")
    await cdp.send("Input.insertText", {text:"30"})
    await evaluate("document.querySelector('input[name=unit]').focus()")
    await cdp.send("Input.insertText", {text:"páginas"})
    await evaluate("document.querySelector('[role=dialog] form button[type=submit]').click()")
    await visible("0/30 páginas")
    const practiceRow = "[...document.querySelectorAll('.objective-link')].find(x=>x.innerText.includes('Ler 30 páginas'))"
    await evaluate(`${practiceRow}.querySelector('details').open=true`)
    await evaluate(`[...${practiceRow}.querySelectorAll('button')].find(x=>x.innerText==='Registrar prática').click()`)
    await visible("Salvar registro")
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(()=>trackersByOwner.get(2).some(item=>item.titulo==='Ler 30 páginas'),"prática independente confirmada")
    const reading = trackersByOwner.get(2).find(item=>item.titulo==='Ler 30 páginas')
    assert.equal(reading.objetivo_id,null)
    await until(()=>evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"),"prática reconciliada")
    assert.equal(await evaluate("Boolean(document.querySelector('[role=dialog] input[name=amount]'))"),true,"formulário permanece aberto após receber ID oficial")
    await setConnectivity(false)
    for (const amount of [20,10]) {
      if (!await evaluate("Boolean(document.querySelector('[role=dialog] input[name=amount]'))")) {
        await evaluate(`${practiceRow}.querySelector('details').open=true`)
        await evaluate(`[...${practiceRow}.querySelectorAll('button')].find(x=>x.innerText==='Registrar prática').click()`)
      }
      await visible("Salvar registro")
      await evaluate("document.querySelector('input[name=amount]').focus()")
      await cdp.send("Input.insertText", {text:String(amount)})
      await evaluate("document.querySelector('[role=dialog] form button[type=submit]').click()")
      await visible(`${amount===20?20:30}/30 páginas`)
    }
    const recordCommands = await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2 && x.domain==='occurrence'))})})()")
    assert.equal(recordCommands.length,2)
    assert.deepEqual(recordCommands.map(item=>item.payload.amount).sort((a,b)=>a-b),[10,20])
    assert.ok(recordCommands.every(item=>item.parentId===reading.id),"formulário antigo resolve o vínculo da ocorrência ao ID oficial")
    assert.ok(recordCommands.every(item=>item.payload.unit==='páginas' && item.payload.plan_effective_from))
    await navigate("/objetivos#habitos")
    await visible("30/30 páginas")
    await auditLayout("practices")
    await evaluate(`${practiceRow}.querySelector('details').open=true`)
    await until(()=>evaluate("[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='Registrar prática')"),"ação de registro visível após expansão")
    await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Registrar prática').click()")
    await visible("Registrar comportamento")
    await auditLayout("practice-record")
    await cdp.send("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape"})
    await until(()=>evaluate("!document.querySelector('[role=dialog]')"),"saída do formulário de prática sem alteração")
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(()=>reading.ocorrencias.length===2,"parciais sincronizadas")
    assert.deepEqual(reading.ocorrencias.map(item=>item.occurred_at).sort(),recordCommands.map(item=>item.payload.occurred_at).sort())
    assert.deepEqual(reading.ocorrencias.map(item=>item.amount).sort((a,b)=>a-b),[10,20])
    await until(()=>evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"),"registros reconciliados")
    await navigate("/objetivos#habitos")
    await visible("30/30 páginas")
    await evaluate(`document.querySelector('[aria-label="Ações do comportamento: Ler 30 páginas"]').click()`)
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(x=>x.innerText==='Pausar').click()")
    await visible("Pausar comportamento")
    await evaluate("document.querySelector('[role=dialog] form button[type=submit]').click()")
    await until(()=>reading.planos.length===2,"pausa preserva plano anterior")
    assert.equal(reading.planos[1].paused,true)
    await visible("30/30 páginas")
    console.log("Práticas PWA: criação offline independente, formulário preservado após receber ID oficial, 20+10, reload, timestamps, replay, pausa e 320–1440px nos dois temas OK")

    const linkedTask = tasksByOwner.get(2).find(item => item.titulo === "Tarefa ligada")
    assert.ok(linkedTask.recurrence)
    const completedLinked = { ...task(nextTaskId++, 2), titulo: "Resultado da recorrência", recurrence: linkedTask.recurrence,
      objetivo_id: linkedGoal.id, status: "CONCLUIDA", status_code: "CONCLUIDA", status_label: "Concluída", completed_at: new Date().toISOString(),
      permissions: { ...linkedTask.permissions, can_delete: false, can_edit: false, can_pin: false, can_complete: false } }
    const tomorrow = new Date(`${todayParts.year}-${todayParts.month}-${todayParts.day}T12:00:00Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    tasksByOwner.get(2).push(completedLinked, { ...task(nextTaskId++, 2), titulo: "Tarefa ligada",
      recurrence: linkedTask.recurrence, objetivo_id: linkedGoal.id, prazo: tomorrow.toISOString().slice(0,10).split('-').reverse().join('-') })
    await navigate("/tarefas/foco")
    await visible("Tarefas de hoje")
    await navigate("/tarefas")
    await visible("Tarefa ligada")
    assert.equal(await evaluate("[...document.querySelectorAll('h3')].filter(el => el.textContent.trim() === 'Tarefa ligada').length"), 1)
    await setConnectivity(false)
    await evaluate("document.querySelector('button[aria-label=\"Ações da tarefa: Tarefa ligada\"]')?.click()")
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'Excluir')?.click()")
    await visible("todas as ocorrências pendentes")
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Excluir')?.click()")
    await until(() => evaluate("![...document.querySelectorAll('h3')].some(el => el.textContent.trim() === 'Tarefa ligada')"), "pendentes removidas da projeção")
    await visible("Resultado da recorrência")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.some(x=>x.action==='delete' && x.recurrenceSeriesId===" + linkedTask.recurrence.series_id + "))})})()"), "metadado de série durável")
    await navigate("/tarefas/foco")
    await visible("Tarefas de hoje")
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Mostrar mais tarefas'))?.click()")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa ligada')"), false)
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => tasksByOwner.get(2).filter(t => t.recurrence?.series_id === linkedTask.recurrence.series_id).length === 1, "exclusão da série sincronizada")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "exclusão reconciliada")
    await setConnectivity(false)
    await navigate("/tarefas/foco")
    await visible("Tarefas de hoje")
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Mostrar mais tarefas'))?.click()")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa ligada')"), false)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').get([2,'tasks:daily:last']);r.onsuccess=()=>ok(r.result?.data.tasks.some(t=>t.titulo==='Resultado da recorrência' && t.status==='CONCLUIDA') && !r.result.data.tasks.some(t=>t.titulo==='Tarefa ligada'))})})()"), true)
    await navigate("/tarefas")
    await visible("Resultado da recorrência")
    assert.equal(await evaluate("document.body.innerText.includes('Tarefa ligada')"), false)
    console.log("PWA: recorrência vinculada aparece em Tarefas; exclusão remove pendentes e preserva concluídas offline, após replay e reload OK")

    const uncertainId = crypto.randomUUID()
    const uncertainTask = { ...task(nextTaskId++, 2), titulo: "Criação enviada a excluir" }
    tasksByOwner.get(2).push(uncertainTask)
    processed.set(`2:${uncertainId}`, uncertainTask)
    await putOutbox({ ownerId: 2, operationId: uncertainId, domain: "task", action: "create",
      payload: { titulo: uncertainTask.titulo, prazo: today }, createdAt: new Date().toISOString(),
      attemptedAt: new Date().toISOString(), status: "pending" })
    await visible(uncertainTask.titulo)
    await evaluate("document.querySelector('button[aria-label=\"Ações da tarefa: Criação enviada a excluir\"]')?.click()")
    await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.trim() === 'Excluir')?.click()")
    await visible("Excluir tarefa")
    await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Excluir')?.click()")
    await until(() => evaluate("!document.body.innerText.includes('Criação enviada a excluir')"), "criação enviada excluída da projeção")
    assert.equal(await outboxStatus(uncertainId), "pending", "criação enviada permanece para reconciliação idempotente")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===2 && r.result.some(x=>x.action==='delete' && typeof x.target==='string'))})})()"), "exclusão depende da criação enviada")
    await navigate("/tarefas")
    assert.equal(await evaluate("document.body.innerText.includes('Criação enviada a excluir')"), false)
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => !tasksByOwner.get(2).some(t => t.id === uncertainTask.id), "reconciliação seguida de exclusão")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "exclusão de criação enviada reconciliada")
    assert.equal(tasksByOwner.get(2).filter(t => t.titulo === uncertainTask.titulo).length, 0)
    console.log("PWA: criação enviada pode ser excluída com replay idempotente, sem descartar a operação original OK")



    await setConnectivity(false)
    await navigate("/financas")
    await visible("Movimento")
    const callsBeforeFinance = syncCalls
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Movimento'))?.click()")
    await visible("Salvar movimento")
    await evaluate("[...document.querySelectorAll('[role=radio]')].find(button => button.textContent.includes('Entrada'))?.click()")
    await evaluate("document.querySelectorAll('[role=dialog] input')[0]?.focus()")
    await cdp.send("Input.insertText", { text: "1234" })
    await evaluate("document.querySelectorAll('[role=dialog] input')[1]?.focus()")
    await cdp.send("Input.insertText", { text: "Receita local" })
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Salvar movimento')?.click()")
    await visible("Receita local")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Movimento'))?.click()")
    await visible("Salvar movimento")
    await evaluate("[...document.querySelectorAll('[role=radio]')].find(button => button.textContent.includes('Saída'))?.click()")
    await evaluate("document.querySelectorAll('[role=dialog] input')[0]?.focus()")
    await cdp.send("Input.insertText", { text: "100" })
    assert.equal(await evaluate("document.querySelectorAll('[role=dialog] input')[0].value"), "1,00")
    await evaluate("document.querySelectorAll('[role=dialog] input')[1]?.focus()")
    await cdp.send("Input.insertText", { text: "Despesa local" })
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Salvar movimento')?.click()")
    await visible("Despesa local")
    assert.equal(await evaluate("document.querySelector('.finance-result').textContent.includes('11,34')"), true)
    assert.equal(syncCalls, callsBeforeFinance)
    await navigate("/financas")
    await visible("Receita local")
    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeFinance = refreshCount
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "finanças sincronizadas")
    assert.equal(refreshCount - refreshesBeforeFinance, 1)
    assert.equal(entriesByOwner.get(2).filter((item) => item.titulo === "Receita local").length, 1)
    assert.equal(entriesByOwner.get(2).find((item) => item.titulo === "Receita local").tipo, "receita")
    assert.equal(entriesByOwner.get(2).find((item) => item.titulo === "Receita local").valor_centavos, 1234)
    assert.equal(entriesByOwner.get(2).find((item) => item.titulo === "Despesa local").tipo, "despesa")
    assert.equal(entriesByOwner.get(2).find((item) => item.titulo === "Despesa local").valor_centavos, 100)
    await until(() => evaluate("document.querySelector('.finance-result').textContent.includes('13,34')"), "saldo oficial após entrada e saída")
    await auditLayout("finances")
    await evaluate("document.querySelector('.finance-chart-reveal')?.setAttribute('open','')")
    assert.equal(await evaluate("document.querySelector('.finance-chart svg').querySelectorAll('path').length"), 1)
    assert.equal(await evaluate("document.querySelector('.finance-chart-total strong').textContent.replace(/\\s/g, '')"), "R$11,34")
    assert.equal(await evaluate("document.querySelector('.finance-chart-axis').textContent.includes('R$')"), true)
    assert.equal(await evaluate("document.querySelectorAll('.finance-chart-details dd').length"), 3)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true)
    assert.equal(await evaluate("document.querySelector('.finance-state').getBoundingClientRect().bottom <= document.querySelector('.finance-month-section').getBoundingClientRect().top"), true)
    await cdp.send("Emulation.clearDeviceMetricsOverride")
    console.log("PWA: entrada e saída preservam tipo e centavos offline, após recarga e sincronização OK")
    console.log("Auditoria integrada: Finanças global/mensal e formulário de prática, 320–1440px nos dois temas OK")

    await setConnectivity(false)
    await navigate("/tarefas")
    await visible("Nova tarefa")
    const callsBeforeRecurring = syncCalls
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Nova tarefa'))?.click()")
    await visible("Registrar tarefa")
    await evaluate("document.querySelector('input[name=\"titulo\"]').focus()")
    await cdp.send("Input.insertText", { text: "Recorrente local" })
    await evaluate("document.querySelector('select[name=\"repeat_type\"]').value='todos_dias'; document.querySelector('select[name=\"repeat_type\"]').dispatchEvent(new Event('change',{bubbles:true}))")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Registrar tarefa')?.click()")
    await visible("Recorrente local")
    await navigate("/tarefas")
    await visible("Recorrente local")
    assert.equal(syncCalls, callsBeforeRecurring)
    assert.equal(tasksByOwner.get(2).filter((item) => item.titulo === "Recorrente local").length, 0)
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "recorrência sincronizada")
    assert.equal(tasksByOwner.get(2).filter((item) => item.titulo === "Recorrente local").length, 1)
    assert.equal(tasksByOwner.get(2).find((item) => item.titulo === "Recorrente local").recurrence.weekdays.length, 7)
    console.log("PWA: intenção recorrente persiste sem materialização local e sincroniza uma série OK")

    await navigate("/tarefas/foco")
    await visible("Tarefas de hoje")
    await setConnectivity(false)
    await navigate("/tarefas/foco")
    await visible("Tarefas de hoje")
    await evaluate("[...document.querySelectorAll('#focus-task-shortcuts button')].find(button => button.textContent.includes('Tarefa do usuário 2'))?.click()")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Iniciar bloco')?.click()")
    await visible("Encerrar bloco")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Encerrar bloco')?.click()")
    await visible("Concluir tarefa")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Concluir tarefa')?.click()")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.some(x=>x.ownerId===2 && x.domain==='task' && x.action==='complete' && x.target===2))})})()"), "conclusão de foco na outbox")
    await navigate("/tarefas/foco")
    await visible("Bloco encerrado")
    assert.equal(tasksByOwner.get(2).find((item) => item.id === 2).status, "PENDENTE")
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>ok(r.result.filter(x=>x.ownerId===2).length===0)})})()"), "conclusão de foco sincronizada")
    assert.equal(tasksByOwner.get(2).find((item) => item.id === 2).status, "CONCLUIDA")
    assert.equal(appliedOrder.filter((item) => item.domain === "task" && item.action === "complete" && item.target === 2).length, 1)
    console.log("PWA: Foco mantém bloco local e conclui tarefa uma única vez após reconexão OK")

    await evaluate("localStorage.setItem('bunkermode_token','expired')")
    const refreshesBeforeReopen = refreshCount
    const credentialBeforeReopen = await evaluate("localStorage.getItem('bunkermode_refresh_token')")
    await navigate("/tarefas")
    await until(() => evaluate("localStorage.getItem('bunkermode_token') === 'two'"), "refresh ao reabrir")
    assert.equal(await evaluate("location.pathname"), "/tarefas")
    assert.equal(refreshCount - refreshesBeforeReopen, 1)
    assert.notEqual(await evaluate("localStorage.getItem('bunkermode_refresh_token')"), credentialBeforeReopen)
    console.log("PWA: reabertura com access expirado restaura rota e sessão OK")

    const conflictId = crypto.randomUUID()
    forcedStatuses.set("Conflito simulado", 409)
    await putOutbox({ ownerId: 2, operationId: conflictId, domain: "goal", action: "update",
      target: 2, payload: { titulo: "Conflito simulado" }, baseUpdatedAt: goalsByOwner.get(2)[0].updated_at,
      createdAt: new Date().toISOString(), status: "pending" })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => outboxStatus(conflictId).then((status) => status === "conflict"), "conflito preservado")
    await navigate("/configuracoes#sincronizacao")
    await visible("Usar versão do servidor")
    forcedStatuses.delete("Conflito simulado")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Usar versão do servidor' && button.getBoundingClientRect().width > 0)?.click()")
    await until(() => outboxStatus(conflictId).then((status) => status === null), "conflito descartado após snapshot")

    const validationId = crypto.randomUUID()
    forcedStatuses.set("Validação simulada", 422)
    await putOutbox({ ownerId: 2, operationId: validationId, domain: "task", action: "create",
      payload: { titulo: "Validação simulada" }, createdAt: new Date().toISOString(), status: "pending" })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => outboxStatus(validationId).then((status) => status === "failed"), "422 marcado como falha")
    forcedStatuses.delete("Validação simulada")
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Descartar' && button.getBoundingClientRect().width > 0)?.click()")
    await until(() => outboxStatus(validationId).then((status) => status === null), "falha descartada")

    const serverErrorId = crypto.randomUUID()
    const callsBefore503 = syncCalls
    forcedStatuses.set("Servidor temporário", 503)
    await putOutbox({ ownerId: 2, operationId: serverErrorId, domain: "task", action: "create",
      payload: { titulo: "Servidor temporário", prazo: today }, createdAt: new Date().toISOString(), status: "pending" })
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => syncCalls > callsBefore503, "503 recebido")
    await until(() => outboxStatus(serverErrorId).then(status => status === "pending"), "503 mantém pending")
    await visible("Serviço temporariamente indisponível")
    assert.equal(await evaluate("document.querySelectorAll('[data-sync-status]').length"), 1)
    await navigate("/tarefas")
    await visible("Servidor temporário")
    assert.equal(await evaluate("document.body.innerText.includes('Aguardando sincronização')"), false)
    await navigate("/tarefas")
    await navigate("/tarefas")
    await visible("Servidor temporário")
    assert.equal(await outboxStatus(serverErrorId), "pending")
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[role=alert]')].filter(el => el.getBoundingClientRect().width > 0).map(el => el.innerText)"), [], "indisponibilidade deve usar somente a superfície central")
    assert.equal(await evaluate("document.body.innerText.includes('Aguardando sincronização')"), false)
    forcedStatuses.delete("Servidor temporário")
    backendFailure = null
    await until(() => outboxStatus(serverErrorId).then((status) => status === null), "recuperação autônoma após 503 sem nova mutação", 30000)
    assert.equal(tasksByOwner.get(2).filter((item) => item.titulo === "Servidor temporário").length, 1)
    console.log("PWA: 409 preserva conflito, 422 fica failed e 5xx mantém pending até nova oportunidade OK")

    await setConnectivity(false)
    await evaluate("window.dispatchEvent(new Event('offline'))")
    const deleteGoalId = crypto.randomUUID()
    await putOutbox({ ownerId: 2, operationId: deleteGoalId, domain: "goal", action: "delete",
      target: 2, payload: {}, baseUpdatedAt: goalsByOwner.get(2).find((goal) => goal.id === 2).updated_at,
      createdAt: new Date().toISOString(), status: "pending" })
    await navigate("/objetivos")
    await visible("Objetivos")
    assert.equal(await evaluate("document.body.innerText.includes('Objetivo 2')"), false)
    assert.equal(await evaluate("(async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('bunkermode-offline');r.onsuccess=()=>ok(r.result)});return await new Promise(ok=>{const r=db.transaction('snapshots').objectStore('snapshots').get([2,'objectives']);r.onsuccess=()=>ok(r.result?.data?.some(x=>x.id===2))})})()"), true)
    await setConnectivity(true)
    await evaluate("window.dispatchEvent(new Event('online'))")
    await until(() => outboxStatus(deleteGoalId).then((status) => status === null), "exclusão de objetivo sincronizada")
    assert.equal(goalsByOwner.get(2).some((goal) => goal.id === 2), false)
    assert.equal(trackersByOwner.get(2).find((item) => item.id === 2).objetivo_id, null)
    console.log("PWA: exclusão de objetivo mantém snapshot oficial até sync e desvincula dependentes OK")

    await evaluate("localStorage.setItem('bunkermode_refresh_token','revoked'); localStorage.setItem('bunkermode_token','expired')")
    await navigate("/tarefas")
    await until(() => evaluate("location.pathname === '/auth'"), "refresh revogado")
    assert.equal(await evaluate("localStorage.getItem('bunkermode_refresh_token')"), null)
    console.log("PWA: refresh revogado encerra sessão OK")

    await setConnectivity(false)
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

    await setConnectivity(true)
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
