import { APP_ROUTES } from "../routes/routeConstants"

export const MODULE_CATALOG = Object.freeze([
  {
    key: "tasks",
    label: "Tarefas",
    description: "Planeje suas tarefas e acompanhe o que precisa ser feito.",
    route: APP_ROUTES.TASKS,
  },
  {
    key: "objectives",
    label: "Objetivos",
    description: "Defina e organize os objetivos que orientam suas escolhas.",
    route: APP_ROUTES.OBJECTIVES,
  },
  {
    key: "finances",
    label: "Finanças",
    description: "Registre movimentos e separe recursos para suas escolhas.",
    route: APP_ROUTES.FINANCES,
  },
])

export function getEnabledModules(user) {
  if (!Array.isArray(user?.enabled_modules)) {
    return MODULE_CATALOG.filter((module) => module.key !== "finances")
  }

  const enabledKeys = new Set(user.enabled_modules)
  return MODULE_CATALOG.filter((module) => enabledKeys.has(module.key))
}
