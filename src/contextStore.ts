import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface ContextRecord {
  agent_id: string;
  context_id: string;
  company_id: string | null;
  created_at: number;
  updated_at: number;
}

export class ContextStore {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        agent_id TEXT PRIMARY KEY,
        context_id TEXT NOT NULL,
        company_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  public getContextId(agentId: string): string | null {
    const row = this.db
      .prepare<[string], { context_id: string }>('SELECT context_id FROM contexts WHERE agent_id = ?')
      .get(agentId);

    return row?.context_id ?? null;
  }

  public saveContextId(agentId: string, contextId: string, companyId: string): void {
    const now = Date.now();

    this.db
      .prepare(
        `
        INSERT INTO contexts (agent_id, context_id, company_id, created_at, updated_at)
        VALUES (@agent_id, @context_id, @company_id, @created_at, @updated_at)
        ON CONFLICT(agent_id) DO UPDATE SET
          context_id = excluded.context_id,
          company_id = excluded.company_id,
          updated_at = excluded.updated_at
      `
      )
      .run({
        agent_id: agentId,
        context_id: contextId,
        company_id: companyId,
        created_at: now,
        updated_at: now
      });
  }

  public deleteContextId(agentId: string): void {
    this.db.prepare('DELETE FROM contexts WHERE agent_id = ?').run(agentId);
  }

  public listAll(): ContextRecord[] {
    return this.db
      .prepare<[], ContextRecord>('SELECT agent_id, context_id, company_id, created_at, updated_at FROM contexts')
      .all();
  }

  public close(): void {
    this.db.close();
  }
}
