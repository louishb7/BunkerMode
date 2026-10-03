import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"
import vm from "node:vm"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"
import ts from "typescript"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
after(() => dom.window.close())

function load(path, dependencies) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, window, navigator, require: (name) => {
    assert(name in dependencies, name)
    return dependencies[name]
  } })
  return exports
}

const connectivity = load("../src/offline/useOnlineStatus.ts", { react: React })
const apiAvailability = load("../src/offline/apiAvailability.ts", {})
const availabilityHook = load("../src/offline/useApiAvailability.ts", {
  react: React,
  "./apiAvailability": apiAvailability,
})
const { default: SyncLabel } = load("../src/components/system/SyncLabel.tsx", { react: React })
let pending = false
const { default: PwaBanners } = load("../src/components/system/PwaBanners.tsx", {
  react: React,
  "lucide-react": { X: () => null },
  "virtual:pwa-register": { registerSW: () => async () => {} },
  "../../offline/useApiAvailability": availabilityHook,
  "../../offline/useOnlineStatus": connectivity,
  "../../context/AuthContext": { useAuth: () => ({ sessionMode: "online" }) },
  "./OutboxNotice": { __esModule: true, default: () => pending ? React.createElement(SyncLabel, { status: "pending" }) : null },
})

function setOnline(online) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online })
}

async function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(PwaBanners)))
  return {
    container,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

for (const online of [true, false]) {
  for (const hasPending of [true, false]) {
    test(`abertura e recarga: online=${online}, pendências=${hasPending}`, async () => {
      setOnline(online)
      pending = hasPending
      apiAvailability.setApiAvailability("unavailable")
      for (let reload = 0; reload < 2; reload++) {
        const view = await mount()
        try {
          assert.equal(view.container.textContent.includes("Aguardando sincronização"), !online)
        } finally {
          await view.close()
        }
      }
    })
  }
}

test("eventos offline/online atualizam o aviso sem aguardar API ou remover pendências", async () => {
  setOnline(true)
  pending = true
  apiAvailability.setApiAvailability("unavailable")
  const view = await mount()
  try {
    assert.equal(view.container.textContent.includes("Aguardando sincronização"), false)
    await act(async () => {
      setOnline(false)
      window.dispatchEvent(new window.Event("offline"))
    })
    assert.equal(view.container.textContent.includes("Aguardando sincronização"), true)
    await act(async () => {
      setOnline(true)
      window.dispatchEvent(new window.Event("online"))
    })
    assert.equal(apiAvailability.getApiAvailability(), "unavailable")
    assert.equal(pending, true)
    assert.equal(view.container.textContent.includes("Aguardando sincronização"), false)
  } finally {
    await view.close()
  }
})

test("estados de envio, falha e conflito continuam visíveis", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    for (const [status, label] of [
      ["pending", ""],
      ["syncing", "Sincronizando"],
      ["failed", "Não foi possível sincronizar"],
      ["conflict", "Conflito de sincronização"],
    ]) {
      await act(async () => root.render(React.createElement(SyncLabel, { status })))
      assert.equal(container.textContent, label)
    }
  } finally {
    await act(async () => root.unmount())
  }
})
