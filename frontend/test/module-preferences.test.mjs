import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

const source = readFileSync(new URL("../src/modules/moduleCatalog.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const exports = {}

vm.runInNewContext(compiled, {
  exports,
  require(path) {
    if (path.endsWith("routeConstants")) {
      return {
        APP_ROUTES: {
          TASKS: "/tarefas",
          OBJECTIVES: "/objetivos",
        },
      }
    }
    throw new Error(path)
  },
})

const { getEnabledModules } = exports
const keysFor = (user) => Array.from(getEnabledModules(user), (module) => module.key)

test("preferências filtram o catálogo sem criar módulos adicionais", () => {
  assert.deepEqual(keysFor({ enabled_modules: ["tasks", "objectives"] }), ["tasks", "objectives"])
  assert.deepEqual(keysFor({ enabled_modules: ["tasks"] }), ["tasks"])
  assert.deepEqual(keysFor({ enabled_modules: ["objectives"] }), ["objectives"])
  assert.deepEqual(keysFor({ enabled_modules: [] }), [])
  assert.deepEqual(keysFor({ enabled_modules: ["finances"] }), ["finances"])
})

test("sessão antiga sem enabled_modules preserva os dois módulos originais como fallback", () => {
  assert.deepEqual(keysFor({}), ["tasks", "objectives"])
})
