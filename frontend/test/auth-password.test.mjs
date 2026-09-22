import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const { createRoot } = await import("react-dom/client")
const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [{ default: AuthScreen }, { default: ResetPasswordScreen }, { api }] = await Promise.all([
  vite.ssrLoadModule("/src/features/auth/components/AuthScreen.tsx"),
  vite.ssrLoadModule("/src/features/auth/components/ResetPasswordScreen.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
])
after(() => vite.close())

async function mount(component) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(component))
  return {
    container,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const click = async (element) => act(async () => element.click())
async function input(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(
      element,
      value
    )
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  })
}
async function submit(container) {
  await act(async () =>
    container
      .querySelector("form")
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
  )
}
const button = (container, label) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === label)

test("login alterna visibilidade sem mudar a senha ou exigir política de cadastro", async () => {
  let payload
  const view = await mount(
    React.createElement(AuthScreen, {
      onLogin: (value) => {
        payload = value
      },
    })
  )
  try {
    await input(view.container.querySelector('[name="identificador"]'), "pessoa")
    const password = view.container.querySelector('[name="senha"]')
    await input(password, "abc")
    assert.equal(password.type, "password")
    assert.equal(view.container.querySelector("ul"), null)
    await click(view.container.querySelector('[aria-label="Mostrar senha"]'))
    assert.equal(password.type, "text")
    assert.equal(password.value, "abc")
    await click(view.container.querySelector('[aria-label="Ocultar senha"]'))
    assert.equal(password.type, "password")
    assert.equal(password.value, "abc")
    await submit(view.container)
    assert.deepEqual(payload, { email: "pessoa", senha: "abc" })
  } finally {
    await view.close()
  }
})

test("cadastro atualiza e reverte os dois requisitos e bloqueia senha inválida", async () => {
  let payload
  const view = await mount(
    React.createElement(AuthScreen, {
      onRegister: (value) => {
        payload = value
      },
    })
  )
  try {
    await click(button(view.container, "Criar conta"))
    await input(view.container.querySelector('[name="usuario"]'), "pessoa")
    await input(view.container.querySelector('[name="email"]'), "pessoa@example.com")
    const password = view.container.querySelector('[name="senha"]')
    const requirements = () =>
      [...view.container.querySelectorAll("li")].map((li) => li.dataset.met)
    const action = view.container.querySelector('[type="submit"]')
    assert.deepEqual(requirements(), ["false", "false"])
    await input(password, "abcde")
    assert.deepEqual(requirements(), ["true", "false"])
    assert.equal(action.disabled, true)
    await input(password, "abcde1")
    assert.deepEqual(requirements(), ["true", "true"])
    assert.equal(view.container.querySelectorAll(".line-through").length, 2)
    assert.equal(action.disabled, false)
    await click(view.container.querySelector('[aria-label="Mostrar senha"]'))
    assert.equal(password.value, "abcde1")
    await input(password, "abcd!1")
    assert.deepEqual(requirements(), ["false", "true"])
    assert.equal(action.disabled, true)
    await submit(view.container)
    assert.equal(payload, undefined)
    await input(password, "abcd")
    assert.deepEqual(requirements(), ["false", "false"])
    await input(password, "abcde1")
    await submit(view.container)
    assert.equal(payload.senha, "abcde1")
  } finally {
    await view.close()
  }
})

test("recuperação apresenta loading, resposta genérica e erro de rede", async () => {
  const original = api.forgotPassword
  let resolve
  api.forgotPassword = () =>
    new Promise((done) => {
      resolve = done
    })
  const view = await mount(React.createElement(AuthScreen, {}))
  try {
    await click(button(view.container, "Esqueci minha senha"))
    assert.equal(view.container.querySelector('[name="senha"]'), null)
    await input(view.container.querySelector('[name="email"]'), "pessoa@example.com")
    await submit(view.container)
    assert.equal(view.container.querySelector('[type="submit"]').disabled, true)
    await act(async () =>
      resolve({
        ok: true,
        data: {
          message:
            "Se existir uma conta com esse e-mail, enviaremos as instruções para redefinir a senha.",
        },
      })
    )
    assert.match(
      view.container.querySelector('[role="status"]').textContent,
      /Se existir uma conta/
    )
    api.forgotPassword = async () => ({ ok: false, status: 0, data: {} })
    await submit(view.container)
    assert.match(view.container.querySelector('[role="alert"]').textContent, /conectar à API/)
  } finally {
    api.forgotPassword = original
    await view.close()
  }
})

function Location() {
  return React.createElement("output", {}, useLocation().search)
}
test("reset mantém token só no formulário, valida requisitos e oferece login após sucesso", async () => {
  const original = api.resetPassword
  const token = "a".repeat(64)
  let payload,
    cleared = false
  api.resetPassword = async (value) => {
    payload = value
    return { ok: false, status: 400, data: { message: "Link inválido ou expirado." } }
  }
  const view = await mount(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`/reset-password?token=${token}`] },
      React.createElement(ResetPasswordScreen, {
        onReset: () => {
          cleared = true
        },
      }),
      React.createElement(Location)
    )
  )
  try {
    assert.equal(view.container.querySelector("output").textContent, "")
    const password = view.container.querySelector('[name="senha"]')
    await input(password, "abcde1")
    assert.equal(view.container.querySelectorAll('[data-met="true"]').length, 2)
    await click(view.container.querySelector('[aria-label="Mostrar senha"]'))
    assert.equal(password.type, "text")
    await input(password, "abcd")
    assert.equal(view.container.querySelectorAll('[data-met="false"]').length, 2)
    assert.equal(view.container.querySelector('[type="submit"]').disabled, true)
    await input(password, "abcde1")
    await submit(view.container)
    assert.deepEqual(payload, { token, password: "abcde1" })
    assert.match(view.container.querySelector('[role="alert"]').textContent, /inválido ou expirado/)
    api.resetPassword = async () => ({ ok: true, data: {} })
    await submit(view.container)
    assert.equal(cleared, true)
    assert.equal(view.container.querySelector('[name="senha"]'), null)
    assert.match(view.container.querySelector('[role="status"]').textContent, /Senha redefinida/)
    assert.equal(view.container.querySelector("a").getAttribute("href"), "/auth")
  } finally {
    api.resetPassword = original
    await view.close()
  }
})
