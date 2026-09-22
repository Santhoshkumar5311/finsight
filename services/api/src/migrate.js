import dotenv from 'dotenv';
import { databaseOptions } from './database-config.js';
dotenv.config({ path: new URL('../../../.env', import.meta.url), quiet: true });
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const pool = new pg.Pool(databaseOptions());
const migrations = [
  '001_schema.sql',
  '002_india_provider.sql',
  '003_runtime_security.sql',
  '004_statement_balances.sql',
];
try {
  for (const file of migrations) {
    await pool.query(await readFile(new URL(`../../../database/${file}`, import.meta.url), 'utf8'));
    console.log(`FinSight schema applied: ${file}`);
  }
} finally {
  await pool.end();
}
