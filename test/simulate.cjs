// Simulasi engine rotasi: node test/simulate.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/engine.js'), 'utf8'), ctx);
const E = ctx.Engine;
const assert = require('assert');

function run(label, { mode, courts, males, females, rounds }) {
  const players = [];
  for (let i = 0; i < males; i++) players.push({ name: 'L' + (i + 1), gender: 'M' });
  for (let i = 0; i < females; i++) players.push({ name: 'P' + (i + 1), gender: 'F' });
  const s = E.newTournament({ mode, scoring: 'simple', courts, players });
  for (let r = 0; r < rounds; r++) {
    const res = E.startNextRound(s);
    assert(res.ok, res.error);
    E.currentRound(s).matches.forEach(m => E.setResult(s, m.id, Math.random() < 0.5 ? 'a' : 'b'));
  }
  const h = E.history(s);
  let backToBackF = 0, backToBackM = 0, femaleSlots = 0;
  const played = (ri, id) => s.rounds[ri].matches.some(m => E.matchIds(m).includes(id));
  s.players.forEach(p => {
    for (let ri = 1; ri < s.rounds.length; ri++) {
      if (played(ri, p.id) && played(ri - 1, p.id)) p.gender === 'F' ? backToBackF++ : backToBackM++;
    }
  });
  // lawan/pasangan berulang
  let oppRepeats = 0, partnerRepeats = 0;
  const ids = s.players.map(p => p.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    oppRepeats += Math.max(0, h.opp(ids[i], ids[j]) - 1);
    partnerRepeats += Math.max(0, h.partner(ids[i], ids[j]) - 1);
  }
  const games = s.players.map(p => h.games(p.id));
  console.log(`${label}: games min/max ${Math.min(...games)}/${Math.max(...games)} | main beruntun wanita ${backToBackF}, pria ${backToBackM} | lawan berulang ${oppRepeats}, pasangan berulang ${partnerRepeats}`);
  return { s, backToBackF, games };
}

// Pemain cukup: wanita tidak pernah main beruntun
let r = run('Ganda 12 org (4P) 2 lap', { mode: 'double', courts: 2, males: 8, females: 4, rounds: 12 });
assert.strictEqual(r.backToBackF, 0, 'wanita tidak boleh main beruntun bila cukup');
// Pemain pas-pasan (hanya 2 istirahat per ronde): sesekali tidak bisa dihindari
r = run('Ganda 10 org (3P) 2 lap', { mode: 'double', courts: 2, males: 7, females: 3, rounds: 12 });
assert(r.backToBackF <= 2);
r = run('Ganda 6 org (2P) 1 lap', { mode: 'double', courts: 1, males: 4, females: 2, rounds: 12 });
assert.strictEqual(r.backToBackF, 0);
r = run('Tunggal 5 org (2P) 1 lap', { mode: 'single', courts: 1, males: 3, females: 2, rounds: 10 });
assert.strictEqual(r.backToBackF, 0);
assert(Math.max(...r.games) - Math.min(...r.games) <= 1, 'jumlah main merata');
run('Ganda 5 org (1P) 1 lap', { mode: 'double', courts: 1, males: 4, females: 1, rounds: 10 });
r = run('Ganda 16 org (6P) 3 lap', { mode: 'double', courts: 3, males: 10, females: 6, rounds: 10 });
assert(r.backToBackF <= 2);

// Pemain belum siap -> diganti cadangan, tidak dipakai lagi di ronde itu
{
  const s = E.newTournament({ mode: 'double', scoring: 'simple', courts: 1, players: 'ABCDEF'.split('').map(n => ({ name: n, gender: 'M' })) });
  E.startNextRound(s);
  const m = E.currentRound(s).matches[0];
  const out = m.a[0];
  const res = E.replacePlayer(s, m.id, out);
  assert(res.ok && !E.matchIds(m).includes(out) && E.matchIds(m).includes(res.inId));
  const res2 = E.replacePlayer(s, m.id, res.inId);
  assert(res2.ok && res2.inId !== out, 'pemain belum siap tidak masuk lagi');
  const res3 = E.replacePlayer(s, m.id, res2.inId);
  assert(!res3.ok, 'cadangan habis');
  // acak ulang ronde tetap mengecualikan yang belum siap
  E.reshuffleRound(s);
  assert(!E.matchIds(E.currentRound(s).matches[0]).includes(out));
  console.log('Belum siap / acak ulang: OK');
}

// Pemain keluar setelah main -> klasemen tetap jalan (bug lama: crash)
{
  const s = E.newTournament({ mode: 'single', scoring: 'score', courts: 1, players: 'ABCD'.split('').map(n => ({ name: n, gender: 'M' })) });
  E.startNextRound(s);
  const m = E.currentRound(s).matches[0];
  E.setScore(s, m.id, 'a', 21); E.setScore(s, m.id, 'b', 15);
  E.startNextRound(s);
  const quitter = m.a[0];
  E.removePlayer(s, quitter);
  const st = E.standings(s);
  const q = st.find(x => x.id === quitter);
  assert(q.wins === 1 && q.diff === 6 && q.points === 3);
  assert(!E.matchIds(E.currentRound(s).matches[0]).includes(quitter));
  console.log('Pemain keluar + klasemen: OK');
}
console.log('Semua tes lulus.');
