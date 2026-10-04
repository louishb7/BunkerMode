import assert from "node:assert/strict"
import { after, test } from "node:test"
import { createServer } from "vite"
const vite = await createServer({ appType: "custom", logLevel: "silent", root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true } })
const { projectTasks } = await vite.ssrLoadModule("/src/offline/outbox.ts")
after(() => vite.close())
const task = (id, series = 31, status = "PENDENTE") => ({ id, titulo: "Tarefa", status,
  status_code: status, objetivo_id: 9, recurrence: series ? { series_id: series } : null,
  permissions: { can_delete: status === "PENDENTE" } })
const deletion = { operationId: "deletion", ownerId: 1, domain: "task", action: "delete", target: 2,
  recurrenceSeriesId: 31, status: "pending", payload: {}, createdAt: new Date().toISOString() }

test("exclusão remove todas as pendentes da série e preserva concluídas, avulsas e outras séries", () => {
  const official = [task(1, 31, "CONCLUIDA"), task(2), task(3), task(4, 32), task(5, null)]
  assert.deepEqual(projectTasks(official, [deletion]).map(t => t.id), [1, 4, 5])
  assert.equal(official.length, 5)
  assert.deepEqual(projectTasks(official, [{ ...deletion, recurrenceSeriesId: undefined }]).map(t => t.id), [1, 4, 5])
})
test("metadado persiste no reload e cobre Home/Foco mesmo sem a ocorrência selecionada no snapshot", () => {
  const daily = [task(1, 31, "CONCLUIDA"), task(3), task(4, 32)]
  const persisted = JSON.parse(JSON.stringify(deletion))
  assert.deepEqual(projectTasks(daily, [persisted]).map(t => t.id), [1, 4])
})
test("conclusão local anterior à exclusão preserva o resultado e reabertura permite excluir recorrência", () => {
  const complete = { ...deletion, action: "complete", target: 3 }
  assert.deepEqual(projectTasks([task(2), task(3)], [complete, deletion]).map(t => t.id), [3])
  const reopened = projectTasks([task(3, 31, "CONCLUIDA")], [{ ...complete, action: "reopen" }])
  assert.equal(reopened[0].permissions.can_delete, true)
})
test("excluir uma avulsa afeta apenas a tarefa selecionada", () => {
  assert.deepEqual(projectTasks([task(2, null), task(3), task(4, null)],
    [{ ...deletion, recurrenceSeriesId: undefined }]).map(t => t.id), [3, 4])
})

test("criação enviada ainda pendente mantém a opção de exclusão", () => {
  const create = { ...deletion, action: "create", target: undefined,
    attemptedAt: new Date().toISOString(), payload: { titulo: "Resposta incerta" } }
  const local = projectTasks([], [create])[0]
  assert.equal(local.permissions.can_delete, true)
  assert.equal(projectTasks([], [create, { ...deletion, recurrenceSeriesId: undefined, target: local.id }]).length, 0)
})
