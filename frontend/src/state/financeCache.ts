import type { FinanceOverview } from "../types/financeContract"
const snapshots = new Map<string, FinanceOverview>()
export const getFinanceSnapshot = (key: string) => snapshots.get(key) ?? null
export const setFinanceSnapshot = (key: string, data: FinanceOverview) => snapshots.set(key, data)
export const clearFinanceSnapshots = () => snapshots.clear()
