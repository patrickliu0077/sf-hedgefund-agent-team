import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExecutionReceipt, RunRecord, TradeDecision } from './types.js'

export class JsonlStore {
  constructor(private readonly dataDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
  }

  async appendRun(run: RunRecord): Promise<void> {
    await this.append('runs.jsonl', run)
  }

  async appendDecision(decision: TradeDecision): Promise<void> {
    await this.append('decisions.jsonl', decision)
  }

  async appendReceipt(receipt: ExecutionReceipt): Promise<void> {
    await this.append('receipts.jsonl', receipt)
  }

  async listRuns(limit = 50): Promise<RunRecord[]> {
    return this.readJsonl<RunRecord>('runs.jsonl', limit)
  }

  async listDecisions(limit = 100): Promise<TradeDecision[]> {
    return this.readJsonl<TradeDecision>('decisions.jsonl', limit)
  }

  async listReceipts(limit = 100): Promise<ExecutionReceipt[]> {
    return this.readJsonl<ExecutionReceipt>('receipts.jsonl', limit)
  }

  private async append(file: string, value: unknown): Promise<void> {
    const path = join(this.dataDir, file)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify(value) + '\n')
  }

  private async readJsonl<T>(file: string, limit: number): Promise<T[]> {
    const path = join(this.dataDir, file)
    const text = await readFile(path, 'utf8').catch(() => '')
    const rows = text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as T
        } catch {
          return null
        }
      })
      .filter((row): row is T => row !== null)
    return rows.slice(-limit).reverse()
  }
}
