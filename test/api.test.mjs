// Tes API terhadap Postgres (PGlite) memakai migrasi asli: node test/api.test.mjs
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert';
register('./loader.mjs', import.meta.url);
const { pg } = await import('./mock-database.mjs');
const dir = new URL('../netlify/database/migrations/', import.meta.url);
for (const f of readdirSync(dir).sort()) await pg.exec(readFileSync(new URL(f, dir), 'utf8'));
const { default: handler } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body) => {
  const res = await handler(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
};
const state = { mode: 'double', scoring: 'simple', courts: 2, name: 'Jumat', players: [{ id: 'p1', name: 'Andri' }], rounds: [] };

let r = await call('GET', '/api/health'); assert.equal(r.status, 200);
r = await call('POST', '/api/players', { players: [{ name: 'Andri', gender: 'M' }, { name: 'andri', gender: 'M' }, { name: 'Sari', gender: 'F' }] });
assert.equal(r.body.saved, 2);
r = await call('POST', '/api/players', { players: [{ name: 'SARI', gender: 'F' }] });
r = await call('GET', '/api/players'); assert.equal(r.body.players.length, 2);
assert.deepEqual(r.body.players[0], { name: 'SARI', gender: 'F' });

r = await call('POST', '/api/tournaments', { state }); assert.equal(r.status, 201);
const id = r.body.id;
r = await call('PUT', `/api/tournaments/${id}`, { state: { ...state, status: 'finished', rounds: [{ num: 1, matches: [] }] } });
assert.equal(r.status, 200);
r = await call('GET', `/api/tournaments/${id}`); assert.equal(r.body.state.rounds.length, 1);
r = await call('GET', '/api/tournaments');
assert.equal(r.body.tournaments[0].status, 'finished'); assert.equal(r.body.tournaments[0].players, 1); assert.equal(r.body.tournaments[0].rounds, 1);
r = await call('POST', '/api/tournaments', { state: { ...state, courts: 99 } }); assert.equal(r.status, 400);
r = await call('GET', '/api/tournaments/bukan-uuid'); assert.equal(r.status, 400);
r = await call('GET', '/api/tournaments/00000000-0000-0000-0000-000000000000'); assert.equal(r.status, 404);
r = await call('DELETE', `/api/tournaments/${id}`); assert.equal(r.status, 200);
console.log('API OK');
