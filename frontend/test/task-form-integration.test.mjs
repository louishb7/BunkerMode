import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

function formHarness(api) {
  const values = []
  let index = 0
  let effects = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const slot = index++
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial
      return [values[slot], (next) => { values[slot] = typeof next === "function" ? next(values[slot]) : next }]
    },
    useEffect(callback) { effects.push(callback) },
  }
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/features/tasks/components/TaskForm.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, {
    exports,
    require(path) {
      if (path === "react") return { ...react, default: react }
      if (path.endsWith("bunkermodeApi")) return { api }
      if (path.endsWith("moduleCatalog")) return { getEnabledModules: (user) => (user.enabled_modules ?? ["tasks", "objectives"]).map((key) => ({ key })) }
      if (path.endsWith("httpClient")) return { getErrorMessage: (_r, fallback) => fallback }
      if (path.endsWith("/date")) return { formatDateForApi: () => "01-09-2026" }
      if (path.endsWith("calendarUtils")) return { operationalDateFor: () => new Date() }
      return { default: path }
    },
  })
  return (props) => {
    index = 0
    effects = []
    const tree = exports.default({ token: "token", ...props })
    return { tree, effects: () => effects.forEach((effect) => effect()) }
  }
}

function findField(tree, name) {
  if (!tree || typeof tree !== "object") return null
  if (tree.props?.name === name) return tree
  for (const child of tree.props?.children ?? []) {
    const found = Array.isArray(child) ? child.map((item) => findField(item, name)).find(Boolean) : findField(child, name)
    if (found) return found
  }
  return null
}

test("formulário sem Objetivos não consulta a API nem altera vínculo existente", async () => {
  const render = formHarness({ listObjetivos: () => { throw new Error("Consulta indevida") } })
  let payload
  const props = {
    currentUser: { enabled_modules: ["tasks"] },
    editingTask: { id: 10, titulo: "Tarefa", objetivo_id: 7 },
    onUpdate: (_id, data) => { payload = data },
  }
  render(props).effects()
  const { tree } = render(props)
  tree.props.onSubmit({ preventDefault() {} })
  assert.equal(Object.hasOwn(payload, "objetivo_id"), false)
  assert.equal(JSON.stringify(tree).includes("Objetivo opcional"), false)
  assert.equal(props.editingTask.objetivo_id, 7)
})

test("criação dentro do objetivo vincula implicitamente sem consulta extra", async () => {
  let reads = 0
  let payload
  const render = formHarness({ listObjetivos: async () => { reads++; return { ok: true, data: [] } } })
  const props = { currentUser: { enabled_modules: ["tasks", "objectives"] }, initialObjetivoId: 7, lockObjetivo: true, onCreate: (data) => { payload = data } }
  render(props).effects()
  const { tree } = render(props)
  tree.props.onSubmit({ preventDefault() {} })
  assert.equal(reads, 0)
  assert.equal(payload.objetivo_id, 7)
  assert.equal(JSON.stringify(tree).includes("Objetivo opcional"), false)
})

test("criação geral mantém tarefa independente mesmo com Objetivos ativo", () => {
  let payload
  const render = formHarness({ listObjetivos: () => { throw new Error("Consulta indevida") } })
  const props = { currentUser: { enabled_modules: ["tasks", "objectives"] }, onCreate: (data) => { payload = data } }
  render(props).effects()
  const { tree } = render(props)
  tree.props.onSubmit({ preventDefault() {} })
  assert.equal(payload.objetivo_id, null)
  assert.equal(payload.duration_type, "pontual")
  assert.equal(JSON.stringify(tree).includes("Objetivo opcional"), false)
})

test("recorrência independente envia dias e término por data", () => {
  let payload
  const render = formHarness({ listObjetivos: () => { throw new Error("Consulta indevida") } })
  const props = { currentUser: { enabled_modules: ["tasks", "objectives"] }, onCreate: (data) => { payload = data } }
  render(props).effects()
  findField(render(props).tree, "repeat_type").props.onChange({ target: { value: "todos_dias" } })
  findField(render(props).tree, "termination_policy").props.onChange({ target: { name: "termination_policy", value: "ate_data" } })
  findField(render(props).tree, "recurrence_end_date").props.onChange({ target: { value: "2026-09-30" } })
  render(props).tree.props.onSubmit({ preventDefault() {} })
  assert.equal(payload.objetivo_id, null)
  assert.equal(payload.duration_type, "ate_data")
  assert.equal(payload.recurrence_end_date, "30-09-2026")
  assert.equal(JSON.stringify(payload.recurrence_weekdays), "[0,1,2,3,4,5,6]")
})
