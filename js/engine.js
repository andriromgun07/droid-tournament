/*
 * Droid Turnamen — engine rotasi & klasemen.
 * Murni (tanpa DOM) supaya bisa diuji dengan Node: `node test/simulate.js`.
 *
 * Aturan prioritas saat memilih siapa yang main di ronde baru:
 *   tier 0  pemain yang ronde lalu istirahat (bergiliran ke orang berikutnya)
 *   tier 1  pemain pria yang baru main 1 ronde berturut-turut
 *   tier 2  pemain pria yang sudah main >= 2 ronde berturut-turut
 *   tier 3  pemain wanita yang baru saja main (selalu diberi jeda bila orang cukup)
 * Di dalam tier yang sama: jumlah main paling sedikit, lalu yang paling lama menunggu, lalu acak.
 *
 * Setelah pemain terpilih, pembagian lapangan/tim dicari dengan biaya terendah:
 *   lawan yang sama (x3), pasangan yang sama di ganda (x4), komposisi gender tim tidak seimbang (x2).
 */
(function (root) {
  'use strict';

  const W_OPPONENT = 3;
  const W_PARTNER = 4;
  const W_GENDER = 2;
  const PAIRING_TRIES = 500;

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function teamSize(state) { return state.mode === 'double' ? 2 : 1; }
  function perMatch(state) { return teamSize(state) * 2; }
  function activePlayers(state) { return state.players.filter(p => p.active); }
  function player(state, id) { return state.players.find(p => p.id === id); }
  function isFemale(state, id) { const p = player(state, id); return !!p && p.gender === 'F'; }
  function matchIds(m) { return [...m.a, ...m.b]; }

  function newTournament(opts) {
    return {
      id: null,
      localId: uid('t'),
      name: opts.name || '',
      mode: opts.mode,
      scoring: opts.scoring,
      courts: opts.courts,
      players: opts.players.map(p => ({ id: uid('p'), name: p.name, gender: p.gender === 'F' ? 'F' : 'M', active: true })),
      rounds: [],
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  // ---------- statistik riwayat ----------
  function history(state, uptoRound) {
    const rounds = uptoRound == null ? state.rounds : state.rounds.slice(0, uptoRound);
    const games = {}, last = {}, opp = {}, partner = {};
    const key = (x, y) => (x < y ? x + '|' + y : y + '|' + x);
    rounds.forEach((r, ri) => r.matches.forEach(m => {
      matchIds(m).forEach(id => { games[id] = (games[id] || 0) + 1; last[id] = ri; });
      m.a.forEach(x => m.b.forEach(y => { const k = key(x, y); opp[k] = (opp[k] || 0) + 1; }));
      [m.a, m.b].forEach(t => { if (t.length === 2) { const k = key(t[0], t[1]); partner[k] = (partner[k] || 0) + 1; } });
    }));
    return {
      rounds,
      games: id => games[id] || 0,
      lastRound: id => (id in last ? last[id] : -1),
      opp: (x, y) => opp[key(x, y)] || 0,
      partner: (x, y) => partner[key(x, y)] || 0,
      streak(id) {
        let s = 0;
        for (let i = rounds.length - 1; i >= 0; i--) {
          if (!rounds[i].matches.some(m => matchIds(m).includes(id))) break;
          s++;
        }
        return s;
      },
    };
  }

  function tierOf(state, h, id) {
    const s = h.streak(id);
    if (s === 0) return 0;
    if (isFemale(state, id)) return 3;
    return s >= 2 ? 2 : 1;
  }

  // Urutkan kandidat dari yang paling berhak main.
  function rankCandidates(state, h, ids) {
    const rnd = new Map(ids.map(id => [id, Math.random()]));
    return [...ids].sort((x, y) =>
      tierOf(state, h, x) - tierOf(state, h, y) ||
      h.games(x) - h.games(y) ||
      h.lastRound(x) - h.lastRound(y) ||
      rnd.get(x) - rnd.get(y));
  }

  // ---------- biaya sebuah partai ----------
  function matchCost(state, h, a, b) {
    let cost = 0;
    a.forEach(x => b.forEach(y => { cost += W_OPPONENT * h.opp(x, y); }));
    [a, b].forEach(t => { if (t.length === 2) cost += W_PARTNER * h.partner(t[0], t[1]); });
    const fa = a.filter(id => isFemale(state, id)).length;
    const fb = b.filter(id => isFemale(state, id)).length;
    cost += W_GENDER * Math.abs(fa - fb);
    return cost;
  }

  // Pembagian terbaik untuk 4 pemain ganda (3 kemungkinan pasangan).
  function bestSplit(state, h, four) {
    const [p, q, r, s] = four;
    const options = [[[p, q], [r, s]], [[p, r], [q, s]], [[p, s], [q, r]]];
    let best = null;
    shuffle(options).forEach(([a, b]) => {
      const c = matchCost(state, h, a, b);
      if (!best || c < best.cost) best = { a, b, cost: c };
    });
    return best;
  }

  // Bagi pemain terpilih ke beberapa lapangan dengan biaya total terendah.
  function arrange(state, h, selected, courts) {
    const n = perMatch(state);
    let best = null;
    for (let t = 0; t < PAIRING_TRIES; t++) {
      const pool = shuffle([...selected]);
      const matches = [];
      let total = 0;
      for (let c = 0; c < courts; c++) {
        const grp = pool.slice(c * n, c * n + n);
        const pick = n === 4 ? bestSplit(state, h, grp) : { a: [grp[0]], b: [grp[1]], cost: matchCost(state, h, [grp[0]], [grp[1]]) };
        matches.push(pick);
        total += pick.cost;
      }
      if (!best || total < best.total) best = { matches, total };
      if (total === 0) break;
    }
    return best.matches.map((m, i) => ({ id: uid('m'), court: i + 1, a: m.a, b: m.b, result: null, scoreA: '', scoreB: '' }));
  }

  function plannedCourts(state, available) {
    return Math.min(state.courts, Math.floor(available / perMatch(state)));
  }

  // Bentuk ronde baru. `exclude` = pemain yang tidak bisa main ronde ini (belum siap).
  function buildRound(state, exclude, uptoRound) {
    const h = history(state, uptoRound);
    const ex = new Set(exclude || []);
    const pool = activePlayers(state).map(p => p.id).filter(id => !ex.has(id));
    const courts = plannedCourts(state, pool.length);
    const ranked = rankCandidates(state, h, pool);
    const selected = ranked.slice(0, courts * perMatch(state));
    const matches = courts > 0 ? arrange(state, h, selected, courts) : [];
    return { matches, notReady: [...ex] };
  }

  function benchOf(state, round) {
    const playing = new Set(round.matches.flatMap(matchIds));
    return activePlayers(state).map(p => p.id).filter(id => !playing.has(id));
  }

  function currentRound(state) { return state.rounds[state.rounds.length - 1] || null; }
  function roundComplete(round) { return !!round && round.matches.every(m => m.result !== null); }
  function roundHasResult(round) { return !!round && round.matches.some(m => m.result !== null); }

  function startNextRound(state) {
    const cur = currentRound(state);
    if (cur && !roundComplete(cur)) return { ok: false, error: 'Selesaikan semua partai dulu.' };
    if (activePlayers(state).length < perMatch(state)) return { ok: false, error: 'Pemain aktif kurang dari ' + perMatch(state) + '.' };
    const r = buildRound(state, []);
    state.rounds.push({ num: state.rounds.length + 1, ...r });
    return { ok: true };
  }

  // Acak ulang seluruh ronde aktif (hanya bila belum ada hasil yang diinput).
  function reshuffleRound(state) {
    const cur = currentRound(state);
    if (!cur) return { ok: false, error: 'Belum ada ronde.' };
    if (roundHasResult(cur)) return { ok: false, error: 'Sudah ada hasil di ronde ini. Batalkan hasilnya dulu.' };
    const keep = (cur.notReady || []).filter(id => player(state, id) && player(state, id).active);
    const r = buildRound(state, keep, state.rounds.length - 1);
    Object.assign(cur, r);
    return { ok: true };
  }

  // Ganti satu pemain yang belum siap / berhalangan dengan pemain cadangan terbaik.
  function replacePlayer(state, matchId, outId, opts) {
    const cur = currentRound(state);
    const m = cur && cur.matches.find(x => x.id === matchId);
    if (!m) return { ok: false, error: 'Partai tidak ditemukan.' };
    if (m.result !== null) return { ok: false, error: 'Partai sudah ada hasil.' };
    const h = history(state, state.rounds.length - 1);
    cur.notReady = cur.notReady || [];
    const blocked = new Set([...cur.notReady, outId]);
    const bench = benchOf(state, cur).filter(id => !blocked.has(id));
    if (!bench.length) return { ok: false, error: 'Tidak ada pemain cadangan yang bisa masuk.' };

    const ranked = rankCandidates(state, h, bench);
    const bestTier = tierOf(state, h, ranked[0]);
    const pool = ranked.filter(id => tierOf(state, h, id) === bestTier).slice(0, 6);

    let best = null;
    pool.forEach((cand, idx) => {
      const four = matchIds(m).map(id => (id === outId ? cand : id));
      let a, b, cost;
      if (four.length === 4) ({ a, b, cost } = bestSplit(state, h, four));
      else { a = [four[0]]; b = [four[1]]; cost = matchCost(state, h, a, b); }
      cost += idx * 0.5; // tetap hormati urutan prioritas
      if (!best || cost < best.cost) best = { a, b, cost, cand };
    });
    m.a = best.a; m.b = best.b;
    if (!(opts && opts.leaving)) cur.notReady.push(outId);
    return { ok: true, inId: best.cand };
  }

  // Pemain keluar dari turnamen (tidak main lagi). Riwayat & poinnya tetap tersimpan.
  function removePlayer(state, id) {
    const p = player(state, id);
    if (!p) return { ok: false };
    const cur = currentRound(state);
    const m = cur && cur.matches.find(x => x.result === null && matchIds(x).includes(id));
    let res = { ok: true };
    if (m) {
      p.active = false;
      res = replacePlayer(state, m.id, id, { leaving: true });
      if (!res.ok) {
        // tidak ada cadangan: partai ini dibatalkan
        cur.matches = cur.matches.filter(x => x !== m);
        cur.matches.forEach((x, i) => { x.court = i + 1; });
        res = { ok: true, cancelled: true };
      }
    }
    p.active = false;
    return res;
  }

  function addPlayer(state, name, gender) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return { ok: false, error: 'Nama kosong.' };
    const existing = state.players.find(p => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      if (existing.active) return { ok: false, error: 'Nama sudah ada.' };
      existing.active = true; existing.gender = gender === 'F' ? 'F' : 'M';
      return { ok: true, player: existing };
    }
    const p = { id: uid('p'), name: clean, gender: gender === 'F' ? 'F' : 'M', active: true };
    state.players.push(p);
    return { ok: true, player: p };
  }

  function setResult(state, matchId, result) {
    const cur = currentRound(state);
    const m = cur && cur.matches.find(x => x.id === matchId);
    if (!m) return;
    m.result = m.result === result ? null : result;
  }

  function setScore(state, matchId, side, value) {
    const cur = currentRound(state);
    const m = cur && cur.matches.find(x => x.id === matchId);
    if (!m) return;
    const v = value === '' || value == null ? '' : Math.max(0, Math.min(99, parseInt(value, 10) || 0));
    if (side === 'a') m.scoreA = v; else m.scoreB = v;
    if (m.scoreA === '' || m.scoreB === '') m.result = null;
    else if (m.scoreA === m.scoreB) m.result = 'draw';
    else m.result = m.scoreA > m.scoreB ? 'a' : 'b';
  }

  // ---------- klasemen ----------
  function standings(state) {
    const s = {};
    state.players.forEach(p => { s[p.id] = { id: p.id, name: p.name, gender: p.gender, active: p.active, played: 0, wins: 0, draws: 0, losses: 0, diff: 0 }; });
    state.rounds.forEach(r => r.matches.forEach(m => {
      if (!m.result) return;
      const scored = m.scoreA !== '' && m.scoreB !== '';
      const apply = (ids, mine, theirs, won, lost) => ids.forEach(id => {
        const x = s[id]; if (!x) return;
        x.played++;
        if (won) x.wins++; else if (lost) x.losses++; else x.draws++;
        if (scored) x.diff += mine - theirs;
      });
      apply(m.a, Number(m.scoreA), Number(m.scoreB), m.result === 'a', m.result === 'b');
      apply(m.b, Number(m.scoreB), Number(m.scoreA), m.result === 'b', m.result === 'a');
    }));
    return Object.values(s)
      .map(x => ({ ...x, points: x.wins * 3 + x.draws }))
      .sort((x, y) => y.points - x.points || y.wins - x.wins || y.diff - x.diff || x.played - y.played || x.name.localeCompare(y.name));
  }

  const api = {
    newTournament, startNextRound, reshuffleRound, replacePlayer, removePlayer, addPlayer,
    setResult, setScore, standings, benchOf, currentRound, roundComplete, roundHasResult,
    perMatch, activePlayers, plannedCourts, history, matchIds,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
