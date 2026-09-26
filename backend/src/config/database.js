import pg from 'pg';
import env from './env.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { message: err.message });
});

/**
 * Execute a parameterised query.
 *
 * @param {string} text — SQL with $1, $2, … placeholders
 * @param {any[]}  params — values for placeholders
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  logger.debug('Executed query', { text, duration, rows: result.rowCount });

  return result;
}

/**
 * Get a client from the pool (for transactions).
 */
export async function getClient() {
  return pool.connect();
}

export default pool;
