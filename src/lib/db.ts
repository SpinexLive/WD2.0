import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __pool?: Pool };
const independent = globalThis as unknown as { __independentPool?: Pool };

function pool(): Pool {
  if (!g.__pool) g.__pool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return g.__pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

/** Durable side effects while holding a worker lock: separate capacity avoids pool starvation by lock waiters. */
export async function independentQuery<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  independent.__independentPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 2 });
  return (await independent.__independentPool.query<T>(text, params)).rows;
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
