import { query } from '../config/database.js';

export async function findById(id) {
  const result = await query(
    'SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function findByEmail(email) {
  const result = await query(
    'SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

export async function findByUsername(username) {
  const result = await query(
    'SELECT id, username, email, created_at FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function create({ username, email, passwordHash }) {
  const result = await query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, created_at`,
    [username, email, passwordHash]
  );
  return result.rows[0];
}

export async function search(q, limit = 20) {
  const result = await query(
    `SELECT id, username FROM users
     WHERE username ILIKE $1
     ORDER BY username
     LIMIT $2`,
    [`%${q}%`, limit]
  );
  return result.rows;
}
