import React, { createContext, useContext } from "react"
import { useLocation } from "react-router-dom"

import { useTaskBoard } from "../features/tasks/hooks/useTaskBoard"
import { APP_ROUTES } from "../routes/routeConstants"
import { useAuth } from "./AuthContext"

const TaskBoardContext = createContext(null)

export function TaskBoardProvider({ children }) {
  const auth = useAuth()
  const location = useLocation()
  const boardMode = location.pathname === APP_ROUTES.TASKS_FOCUS ? "focus" : "tasks"
  const board = useTaskBoard({
    authenticated: auth.authenticated,
    onUnauthorized: auth.handleUnauthorized,
    token: auth.token,
    timezone: auth.user?.timezone,
    boardMode,
  })

  return <TaskBoardContext.Provider value={board}>{children}</TaskBoardContext.Provider>
}

export function useTaskBoardContext() {
  const board = useContext(TaskBoardContext)
  if (!board) {
    throw new Error("useTaskBoardContext deve ser usado dentro de TaskBoardProvider.")
  }
  return board
}
