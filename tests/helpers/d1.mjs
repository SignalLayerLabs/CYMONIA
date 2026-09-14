import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

export class D1TestDB {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys=ON");
    this.raw.exec(readFileSync("migrations/0001_participatory_economy.sql", "utf8"));
  }
  prepare(sql) { return new D1Statement(this.raw, sql); }
  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      this.raw.exec("COMMIT");
      return out;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}
