// REST API Droid Turnamen — Netlify Function + Netlify Database (Postgres)
//
//   GET    /api/health
//   GET    /api/players                 nama + gender yang pernah dipakai
//   POST   /api/players                 { players: [{ name, gender }] }  (upsert)
//   GET    /api/tournaments             20 turnamen terakhir
//   POST   /api/tournaments             { state }  -> { id, updatedAt }
//   GET    /api/tournaments/:id         -> { id, state, updatedAt }
//   PUT    /api/tournaments/:id         { state }  -> { id, updatedAt }
//   DELETE /api/tournaments/:id
import { getDatabase } from '@netlify/database';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STATE_BYTES = 512 * 1024;

let db;
const sql = (...args) => {
  db ??= getDatabase();
  return db.sql(...args);
};
const values = rows => {
  db ??= getDatabase();
  return db.sql.values(rows);
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status, message) => json({ error: message }, status);

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_STATE_BYTES) throw Object.assign(new Error('Data terlalu besar'), { status: 413 });
  try { return JSON.parse(text || '{}'); }
  catch { throw Object.assign(new Error('JSON tidak valid'), { status: 400 }); }
}

function validateState(state) {
  if (!state || typeof state !== 'object') return 'state wajib diisi';
  if (!['single', 'double'].includes(state.mode)) return 'mode tidak valid';
  if (!['simple', 'score'].includes(state.scoring)) return 'scoring tidak valid';
  const courts = Number(state.courts);
  if (!Number.isInteger(courts) || courts < 1 || courts > 6) return 'jumlah lapangan tidak valid';
  if (!Array.isArray(state.players) || !Array.isArray(state.rounds)) return 'players/rounds wajib array';
  return null;
}

function meta(state) {
  return {
    name: String(state.name || '').slice(0, 80),
    mode: state.mode,
    scoring: state.scoring,
    courts: Number(state.courts),
    status: state.status === 'finished' ? 'finished' : 'active',
  };
}

// ---------- handlers ----------
async function listPlayers() {
  const rows = await sql`
    SELECT name, gender FROM players ORDER BY last_used_at DESC, name LIMIT 200`;
  return json({ players: rows });
}

async function upsertPlayers(req) {
  const body = await readBody(req);
  const seen = new Set();
  const rows = [];
  for (const p of Array.isArray(body.players) ? body.players : []) {
    const name = String(p?.name || '').trim().slice(0, 40);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    rows.push([name, p.gender === 'F' ? 'F' : 'M']);
  }
  if (!rows.length) return json({ saved: 0 });
  await sql`
    INSERT INTO players (name, gender) VALUES ${values(rows.slice(0, 100))}
    ON CONFLICT ((lower(name)))
    DO UPDATE SET name = EXCLUDED.name, gender = EXCLUDED.gender, last_used_at = now()`;
  return json({ saved: rows.length });
}

async function listTournaments() {
  const rows = await sql`
    SELECT id, name, mode, courts, status, created_at, updated_at,
           jsonb_array_length(state->'rounds') AS rounds,
           (SELECT count(*) FROM jsonb_array_elements(state->'players')) AS players
    FROM tournaments ORDER BY updated_at DESC LIMIT 20`;
  return json({
    tournaments: rows.map(r => ({ ...r, rounds: Number(r.rounds), players: Number(r.players) })),
  });
}

async function createTournament(req) {
  const { state } = await readBody(req);
  const err = validateState(state);
  if (err) return fail(400, err);
  const m = meta(state);
  const [row] = await sql`
    INSERT INTO tournaments (name, mode, scoring, courts, status, state)
    VALUES (${m.name}, ${m.mode}, ${m.scoring}, ${m.courts}, ${m.status}, ${JSON.stringify(state)}::jsonb)
    RETURNING id, updated_at`;
  return json({ id: row.id, updatedAt: row.updated_at }, 201);
}

async function getTournament(id) {
  const [row] = await sql`SELECT id, state, updated_at FROM tournaments WHERE id = ${id}`;
  if (!row) return fail(404, 'Turnamen tidak ditemukan');
  return json({ id: row.id, state: row.state, updatedAt: row.updated_at });
}

async function updateTournament(req, id) {
  const { state } = await readBody(req);
  const err = validateState(state);
  if (err) return fail(400, err);
  const m = meta(state);
  const [row] = await sql`
    UPDATE tournaments
    SET name = ${m.name}, mode = ${m.mode}, scoring = ${m.scoring}, courts = ${m.courts},
        status = ${m.status}, state = ${JSON.stringify(state)}::jsonb, updated_at = now()
    WHERE id = ${id}
    RETURNING id, updated_at`;
  if (!row) return fail(404, 'Turnamen tidak ditemukan');
  return json({ id: row.id, updatedAt: row.updated_at });
}

async function deleteTournament(id) {
  await sql`DELETE FROM tournaments WHERE id = ${id}`;
  return json({ deleted: true });
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id] = parts;
  const method = req.method;

  try {
    if (resource === 'health' && method === 'GET') {
      await sql`SELECT 1`;
      return json({ ok: true });
    }
    if (resource === 'players' && !id) {
      if (method === 'GET') return await listPlayers();
      if (method === 'POST') return await upsertPlayers(req);
    }
    if (resource === 'tournaments') {
      if (!id) {
        if (method === 'GET') return await listTournaments();
        if (method === 'POST') return await createTournament(req);
      } else {
        if (!UUID_RE.test(id)) return fail(400, 'ID tidak valid');
        if (method === 'GET') return await getTournament(id);
        if (method === 'PUT') return await updateTournament(req, id);
        if (method === 'DELETE') return await deleteTournament(id);
      }
    }
    return fail(404, 'Endpoint tidak ditemukan');
  } catch (e) {
    console.error(e);
    return fail(e.status || 500, e.status ? e.message : 'Gagal mengakses database');
  }
};

export const config = { path: ['/api', '/api/*'] };
