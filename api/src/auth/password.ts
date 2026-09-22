import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const KEY_LENGTH = 64
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1

export function hashPassword(password: string): string {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Informe uma senha.")
  }

  const salt = randomBytes(16).toString("hex")
  const digest = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  }).toString("hex")
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt}$${digest}`
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [algorithm, cost, blockSize, parallelization, salt, digest] = passwordHash.split("$")
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelization || !salt || !digest) {
    return false
  }

  const expected = Buffer.from(digest, "hex")
  const current = scryptSync(password, salt, expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelization),
  })
  return current.length === expected.length && timingSafeEqual(current, expected)
}
