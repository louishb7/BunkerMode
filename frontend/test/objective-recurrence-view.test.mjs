import assert from "node:assert/strict"
import { after, test } from "node:test"
import { createServer } from "vite"

const vite = await createServer({ appType: "custom", logLevel: "silent", root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true } })
const { groupObjectiveTasks } = await vite.ssrLoadModule("/src/features/objectives/hooks/useObjectiveTasks.ts")
after(() => vite.close())

test("objetivo mostra uma ocorrência por série sem confundir títulos iguais", () => {
  const task = (id, series_id, status = "PENDENTE", titulo = "Não fumar") => ({ id, titulo, status, objetivo_id: 7, recurrence: series_id ? { series_id, weekdays: [0,1,2,3,4,5,6] } : null })
  const grouped = groupObjectiveTasks([task(1, 11, "CONCLUIDA"), task(2, 11), task(3, 12), task(4, 12), task(5, null)])
  assert.deepEqual(grouped["7"].map((item) => item.id), [2, 3, 5])
})
