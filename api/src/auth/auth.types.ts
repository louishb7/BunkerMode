export type UserRecord = {
  usuario_id: number
  usuario: string
  email: string
  senha_hash: string
  auth_version: number
  ativo: boolean
  enabled_modules: string[]
  timezone: string
  created_at: Date
  updated_at: Date
}

export type UserResponse = {
  id: number
  usuario: string
  email: string
  enabled_modules: string[]
  timezone: string
  created_at: string
  updated_at: string
  ativo?: boolean
}

export type AuthenticatedRequest = {
  currentUser?: UserRecord
}
