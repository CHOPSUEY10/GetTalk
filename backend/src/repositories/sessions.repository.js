/**
 * Sessions Repository — database access for sessions table.
 */

export async function create(/* { userId, token, expiresAt } */) {
  throw new Error('sessions.repository.create not implemented');
}

export async function findById(/* sessionId */) {
  throw new Error('sessions.repository.findById not implemented');
}

export async function deleteById(/* sessionId */) {
  throw new Error('sessions.repository.deleteById not implemented');
}

export async function deleteAllByUserId(/* userId */) {
  throw new Error('sessions.repository.deleteAllByUserId not implemented');
}
