import React from "react"
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom"

import BootScreen from "../components/system/BootScreen"
import AppShell from "../components/layout/AppShell"
import ExecutionLayout from "../components/layout/ExecutionLayout"
import { emptyStatus } from "../constants/uiState"
import { useAuth } from "../context/AuthContext"
import { TaskBoardProvider, useTaskBoardContext } from "../context/TaskBoardContext"
import AuthScreen from "../features/auth/components/AuthScreen"
import ResetPasswordScreen from "../features/auth/components/ResetPasswordScreen"
import HomePage from "../features/home/pages/HomePage"
import ObjectivesPage from "../features/objectives/pages/ObjectivesPage"
import SettingsPage from "../features/settings/pages/SettingsPage"
import FocusPage from "../features/tasks/pages/FocusPage"
import TasksPage from "../features/tasks/pages/TasksPage"
import { getEnabledModules } from "../modules/moduleCatalog"
import { APP_ROUTES } from "../routes/routeConstants"

export default function App() {
  const auth = useAuth()

  if (auth.booting) {
    return <BootScreen />
  }

  return (
    <Routes>
      <Route path={APP_ROUTES.AUTH} element={<AuthRoute />} />
      <Route path="/reset-password" element={<ResetPasswordScreen onReset={auth.clearSession} />} />
      <Route
        element={
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        }
      >
        <Route path={APP_ROUTES.ROOT} element={<HomeRoute />} />
        <Route path={APP_ROUTES.SETTINGS} element={<SettingsRoute />} />
        <Route
          path={APP_ROUTES.OBJECTIVES}
          element={
            <EnabledModuleRoute moduleKey="objectives">
              <ObjectivesRoute />
            </EnabledModuleRoute>
          }
        />
        <Route
          element={
            <EnabledModuleRoute moduleKey="tasks">
              <TaskBoardProvider>
                <Outlet />
              </TaskBoardProvider>
            </EnabledModuleRoute>
          }
        >
          <Route path={APP_ROUTES.TASKS_FOCUS} element={<FocusRoute />} />
          <Route path={APP_ROUTES.TASKS} element={<TasksRoute />} />
        </Route>
      </Route>
      <Route
        path="*"
        element={<Navigate to={auth.authenticated ? APP_ROUTES.ROOT : APP_ROUTES.AUTH} replace />}
      />
    </Routes>
  )
}

function AuthRoute() {
  const auth = useAuth()

  if (auth.authenticated) {
    return <Navigate to={APP_ROUTES.ROOT} replace />
  }

  return (
    <AuthScreen
      loading={auth.authLoading}
      onLogin={auth.login}
      onRegister={auth.register}
      status={auth.authStatus}
    />
  )
}

function HomeRoute() {
  const auth = useAuth()
  const logout = useLogout()

  return (
    <AppShell onLogout={logout} user={auth.user}>
      <HomePage onUnauthorized={auth.handleUnauthorized} token={auth.token} user={auth.user} />
    </AppShell>
  )
}

function SettingsRoute() {
  const auth = useAuth()
  const logout = useLogout()

  return (
    <AppShell onLogout={logout} user={auth.user}>
      <SettingsPage
        onUnauthorized={auth.handleUnauthorized}
        onUpdateUser={auth.updateCurrentUser}
        token={auth.token}
        user={auth.user}
      />
    </AppShell>
  )
}

function ProtectedRoute({ children }) {
  const auth = useAuth()

  if (!auth.authenticated) {
    return <Navigate to={APP_ROUTES.AUTH} replace />
  }

  return children
}

function EnabledModuleRoute({ children, moduleKey }) {
  const auth = useAuth()
  const enabled = getEnabledModules(auth.user).some((module) => module.key === moduleKey)

  if (!enabled) {
    return <Navigate to={APP_ROUTES.ROOT} replace />
  }

  return children
}

function TasksRoute() {
  const navigate = useNavigate()
  const auth = useAuth()
  const board = useTaskBoardContext()
  const logout = useLogout()

  function startFocus() {
    board.setStatus(emptyStatus)
    navigate(APP_ROUTES.TASKS_FOCUS, { replace: true })
    return true
  }

  return (
    <AppShell onLogout={logout} user={auth.user}>
      <TasksPage
        board={board}
        onStartFocus={startFocus}
        user={auth.user}
      />
    </AppShell>
  )
}

function ObjectivesRoute() {
  const auth = useAuth()
  const logout = useLogout()

  return (
    <AppShell onLogout={logout} user={auth.user}>
      <ObjectivesPage
        onUnauthorized={auth.handleUnauthorized}
        token={auth.token}
        user={auth.user}
      />
    </AppShell>
  )
}

function FocusRoute() {
  const navigate = useNavigate()
  const auth = useAuth()
  const board = useTaskBoardContext()

  function returnToTasks() {
    board.setStatus(emptyStatus)
    navigate(APP_ROUTES.TASKS, { replace: true })
    return true
  }

  return (
    <ExecutionLayout onReturnToTasks={returnToTasks}>
      <FocusPage
        key={auth.user.id}
        userId={auth.user.id}
        onExit={returnToTasks}
        board={board}
        dailyTasks={board.dailyTasks}
        timezone={auth.user?.timezone}
      />
    </ExecutionLayout>
  )
}

function useLogout() {
  const navigate = useNavigate()
  const auth = useAuth()

  return () => {
    auth.clearSession()
    navigate(APP_ROUTES.AUTH, { replace: true })
  }
}
