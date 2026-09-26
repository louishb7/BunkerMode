export type ModuleKey = "tasks" | "objectives" | "finances"

export type User = {
  id: number
  usuario: string
  email: string
  enabled_modules: ModuleKey[]
  timezone: string
  created_at: string
  updated_at: string
  ativo?: boolean
}

export type AuthSession = {
  access_token: string
  token_type: "bearer"
  usuario: User
}
