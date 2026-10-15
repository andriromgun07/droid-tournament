/* Droid Turnamen — UI, penyimpanan lokal, dan sinkronisasi ke Netlify Database. */
(function () {
  'use strict';
  const E = window.Engine;
  const LS_CURRENT = 'droid:current';
  const LS_PLAYERS = 'droid:players';

  let state = null;          // turnamen aktif
  let viewIdx = null;        // indeks ronde yang dilihat (null = ronde sekarang)
  let draft = null;          // isian layar setup
  let newGender = 'M';
  let known = loadJSON(LS_PLAYERS, []); // [{name, gender}] pemain yang pernah ikut

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function loadJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* penyimpanan penuh/diblokir */ } }

  // ---------- util UI ----------
  function go(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
    if (id === 'screen-home') { setUrl(null); renderHome(); }
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function openSheet(html) {
    $('#sheet-body').innerHTML = html;
    $('#sheet').hidden = false;
    const first = $('#sheet-body').querySelector('input, button');
    if (first && first.tagName === 'INPUT') setTimeout(() => first.focus(), 60);
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet-body').innerHTML = ''; }
  function setUrl(id) {
    const url = id ? location.pathname + '?t=' + id : location.pathname;
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  }
  function draw(action) {
    $('#drawing').hidden = false;
    setTimeout(() => { action(); $('#drawing').hidden = true; }, 450);
  }
  const playerById = id => state.players.find(p => p.id === id);
  const nameTag = (id) => {
    const p = playerById(id);
    if (!p) return '?';
    return esc(p.name) + (p.gender === 'F' ? '<span class="fbadge" title="Perempuan">P</span>' : '');
  };
  const dateLabel = d => new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  // ---------- API ----------
  async function api(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000); // database bisa "bangun tidur" dulu
    try {
      const res = await fetch('/api' + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { status: res.status });
      return data;
    } finally { clearTimeout(timer); }
  }

  // ---------- simpan & sinkron ----------
  let dirty = false, syncing = false, syncTimer = null, lastServerAt = null;
  function setSync(cls, text) { const s = $('#sync-status'); s.className = 'sync ' + cls; s.textContent = text; }

  function persist() {
    state.savedAt = Date.now();
    saveJSON(LS_CURRENT, state);
    dirty = true;
    setSync('busy', 'Menyimpan…');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 700);
  }

  async function sync() {
    if (!state || !dirty) return;
    if (syncing) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 700); return; }
    syncing = true; dirty = false;
    const t = state;
    try {
      if (!t.id) {
        const r = await api('POST', '/tournaments', { state: t });
        t.id = r.id; lastServerAt = r.updatedAt;
        if (t === state) { saveJSON(LS_CURRENT, t); setUrl(t.id); }
      } else {
        const r = await api('PUT', '/tournaments/' + t.id, { state: t });
        lastServerAt = r.updatedAt;
      }
      if (t === state) setSync('ok', 'Tersimpan');
    } catch (e) {
      if (e.status === 404) t.id = null;    // dihapus di server: buat ulang
      if (t === state) { dirty = true; setSync('off', 'Offline, tersimpan di HP ini'); }
      clearTimeout(syncTimer); syncTimer = setTimeout(sync, 15000);
    } finally {
      syncing = false;
      if (dirty && t === state && navigator.onLine) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1500); }
    }
  }
  window.addEventListener('online', () => { if (dirty) sync(); });

  // HP lain yang membuka link yang sama ikut melihat perubahan terbaru
  setInterval(async () => {
    if (!state || !state.id || dirty || syncing || document.hidden || !$('#screen-play').classList.contains('active')) return;
    if (!$('#sheet').hidden || document.activeElement?.classList.contains('score-in')) return;
    try {
      const r = await api('GET', '/tournaments/' + state.id);
      if (r.updatedAt !== lastServerAt && (r.state.savedAt || 0) > (state.savedAt || 0) && !dirty) {
        lastServerAt = r.updatedAt;
        state = { ...r.state, id: r.id };
        saveJSON(LS_CURRENT, state);
        renderPlay();
      }
    } catch { /* abaikan */ }
  }, 20000);

  function rememberPlayers(list) {
    const map = new Map(known.map(p => [p.name.toLowerCase(), p]));
    list.forEach(p => map.delete(p.name.toLowerCase()));
    known = [...list.map(p => ({ name: p.name, gender: p.gender })), ...map.values()].slice(0, 200);
    saveJSON(LS_PLAYERS, known);
    api('POST', '/players', { players: list.map(p => ({ name: p.name, gender: p.gender })) }).catch(() => {});
  }
  async function refreshKnownPlayers() {
    try {
      const r = await api('GET', '/players');
      const server = r.players || [];
      const names = new Set(server.map(p => p.name.toLowerCase()));
      known = [...server, ...known.filter(p => !names.has(p.name.toLowerCase()))];
      saveJSON(LS_PLAYERS, known);
      if ($('#screen-setup').classList.contains('active')) renderSuggestions();
    } catch { /* pakai cache lokal */ }
  }

  // ---------- BERANDA ----------
  function renderHome() {
    const box = $('#resume-box');
    if (state && state.status !== 'finished' && state.rounds.length) {
      const active = E.activePlayers(state).length;
      box.innerHTML = '<button class="resume" id="btn-resume-home"><strong>Lanjutkan ' + esc(state.name || 'turnamen') +
        '</strong><span>Ronde ' + state.rounds.length + ', ' + active + ' pemain aktif</span></button>';
      $('#btn-resume-home').onclick = () => { viewIdx = null; renderPlay(); go('screen-play'); setUrl(state.id); };
    } else box.innerHTML = '';
    loadHistory();
  }

  async function loadHistory() {
    const el = $('#history-list');
    try {
      const { tournaments } = await api('GET', '/tournaments');
      if (!tournaments.length) { el.innerHTML = '<p class="muted small">Belum ada. Turnamen yang kamu buat akan tersimpan di sini.</p>'; return; }
      el.innerHTML = tournaments.map(t =>
        '<button class="history-item" data-id="' + t.id + '"><span><b>' + esc(t.name || 'Tanpa nama') + '</b><small>' +
        dateLabel(t.updated_at) + ', ' + t.players + ' pemain, ' + t.rounds + ' ronde, ' + (t.mode === 'double' ? 'ganda' : 'tunggal') +
        '</small></span><span class="tag' + (t.status === 'active' ? ' live' : '') + '">' + (t.status === 'active' ? 'Berjalan' : 'Selesai') + '</span></button>'
      ).join('');
    } catch {
      el.innerHTML = '<p class="muted small">Riwayat butuh koneksi ke server. Turnamen terakhir tetap tersimpan di HP ini.</p>';
    }
  }

  async function openTournament(id) {
    try {
      const r = await api('GET', '/tournaments/' + id);
      if (state && state.id !== id && dirty) await sync();
      state = { ...r.state, id: r.id };
      lastServerAt = r.updatedAt; dirty = false;
      saveJSON(LS_CURRENT, state);
      viewIdx = null;
      setSync('ok', 'Tersimpan');
      if (state.status === 'finished') { renderSummary(); go('screen-summary'); }
      else { renderPlay(); go('screen-play'); }
      setUrl(state.id);
    } catch (e) {
      toast(e.status === 404 ? 'Turnamen tidak ditemukan.' : 'Gagal memuat turnamen. Cek koneksi.');
    }
  }

  // ---------- SETUP ----------
  function startSetup() {
    if (state && dirty && state.status !== 'finished' &&
        !confirm('Turnamen sekarang belum tersimpan ke server. Tetap buat turnamen baru? Data lama tetap ada di HP ini sampai diganti.')) return;
    const last = state ? E.activePlayers(state).map(p => ({ name: p.name, gender: p.gender })) : [];
    draft = {
      name: 'Main bareng ' + dateLabel(Date.now()),
      players: last,
      mode: state?.mode || 'double',
      courts: state?.courts || 1,
      scoring: state?.scoring || 'simple',
    };
    $('#t-name').value = draft.name;
    $('#new-name').value = '';
    setNewGender('M');
    renderSetup();
    go('screen-setup');
    refreshKnownPlayers();
  }

  function setNewGender(g) {
    newGender = g;
    const b = $('#new-gender');
    b.dataset.g = g; b.textContent = g === 'F' ? 'P' : 'L';
    b.setAttribute('aria-label', 'Jenis kelamin: ' + (g === 'F' ? 'perempuan' : 'laki-laki'));
  }

  function addDraftNames(text) {
    const names = String(text).split(/[,;\n]+/).map(s => s.trim().slice(0, 40)).filter(Boolean);
    let added = 0;
    names.forEach(n => {
      if (draft.players.some(p => p.name.toLowerCase() === n.toLowerCase())) return;
      const k = known.find(p => p.name.toLowerCase() === n.toLowerCase());
      const gender = newGender === 'F' ? 'F' : (k?.gender || 'M');
      draft.players.push({ name: k?.name || n, gender }); added++;
    });
    if (names.length && !added) toast('Nama sudah ada di daftar.');
    return added;
  }

  function renderSetup() {
    const roster = $('#roster');
    roster.innerHTML = draft.players.length ? draft.players.map((p, i) =>
      '<li><span class="name">' + esc(p.name) + '</span>' +
      '<button class="gender-toggle" data-act="g" data-i="' + i + '" data-g="' + p.gender + '" aria-label="Ganti jenis kelamin ' + esc(p.name) + '">' + (p.gender === 'F' ? 'P' : 'L') + '</button>' +
      '<button class="icon-btn" data-act="rm" data-i="' + i + '" aria-label="Hapus ' + esc(p.name) + '">×</button></li>'
    ).join('') : '<li class="empty-roster">Belum ada pemain. Ketik nama di atas atau ketuk nama tersimpan.</li>';
    $('#player-count').textContent = draft.players.length;
    document.querySelectorAll('#screen-setup .seg').forEach(seg => {
      const v = String(draft[seg.dataset.setting]);
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    });
    renderSuggestions();
    renderSetupSummary();
  }

  function renderSuggestions() {
    const q = $('#new-name').value.trim().toLowerCase();
    const inRoster = new Set(draft.players.map(p => p.name.toLowerCase()));
    const list = known.filter(p => !inRoster.has(p.name.toLowerCase()) && (!q || p.name.toLowerCase().includes(q))).slice(0, 14);
    $('#suggestions').innerHTML = list.map(p =>
      '<button class="chip' + (p.gender === 'F' ? ' f' : '') + '" data-name="' + esc(p.name) + '" data-g="' + p.gender + '">+ ' + esc(p.name) + '</button>').join('');
  }

  function renderSetupSummary() {
    const n = draft.players.length;
    const per = draft.mode === 'double' ? 4 : 2;
    const note = $('#setup-summary');
    const btn = $('#btn-start');
    if (n < per) {
      note.className = 'foot-note warn';
      note.textContent = 'Format ' + (draft.mode === 'double' ? 'ganda' : 'tunggal') + ' butuh minimal ' + per + ' pemain (sekarang ' + n + ').';
      btn.disabled = true; return;
    }
    const courts = Math.min(draft.courts, Math.floor(n / per));
    const playing = courts * per;
    note.className = 'foot-note';
    note.textContent = n + ' pemain di ' + courts + ' lapangan: ' + playing + ' main, ' + (n - playing) + ' istirahat tiap ronde' +
      (courts < draft.courts ? ' (pemain baru cukup untuk ' + courts + ' lapangan)' : '') + '.';
    btn.disabled = false;
  }

  function startTournament() {
    if ($('#new-name').value.trim()) addDraftNames($('#new-name').value);
    draft.name = $('#t-name').value.trim() || draft.name;
    const per = draft.mode === 'double' ? 4 : 2;
    if (draft.players.length < per) { renderSetup(); return; }
    rememberPlayers(draft.players);
    state = E.newTournament(draft);
    lastServerAt = null;
    E.startNextRound(state);
    viewIdx = null;
    persist();
    go('screen-play');
    draw(() => renderPlay(true));
  }

  // ---------- MAIN ----------
  function viewedRound() {
    const i = viewIdx == null ? state.rounds.length - 1 : viewIdx;
    return { round: state.rounds[i], idx: i, past: i !== state.rounds.length - 1 };
  }

  function halfHTML(m, side, past) {
    const ids = side === 'a' ? m.a : m.b;
    const cls = ['half', side];
    if (m.result === side) cls.push('win');
    else if (m.result === 'draw') cls.push('draw');
    else if (m.result) cls.push('lose');
    const names = ids.map(id => '<span class="pname">' + nameTag(id) + '</span>').join('');
    const score = side === 'a' ? m.scoreA : m.scoreB;
    if (state.scoring === 'score') {
      const inner = past
        ? '<span class="pname" style="font:700 28px var(--display)">' + (score === '' ? '–' : score) + '</span>'
        : '<input class="score-in" type="number" inputmode="numeric" min="0" max="99" data-m="' + m.id + '" data-side="' + side + '" value="' + score + '" aria-label="Skor ' + esc(ids.map(id => playerById(id)?.name).join(' dan ')) + '">';
      return '<div class="' + cls.join(' ') + '">' + names + inner + '</div>';
    }
    const label = m.result === side ? '<span class="win-label">Menang</span>' : (m.result === 'draw' ? '<span class="win-label">Seri</span>' : '');
    if (past) return '<div class="' + cls.join(' ') + '">' + names + label + '</div>';
    return '<button class="' + cls.join(' ') + '" data-act="win" data-m="' + m.id + '" data-side="' + side + '" aria-pressed="' + (m.result === side) +
      '" aria-label="' + esc(ids.map(id => playerById(id)?.name).join(' dan ')) + ' menang">' + names + label + '</button>';
  }

  function courtHTML(m, past) {
    const done = m.result !== null;
    const actions = past ? '' :
      '<div class="court-actions">' +
        (state.scoring === 'simple' ? '<button class="link-btn' + (m.result === 'draw' ? ' on' : '') + '" data-act="draw" data-m="' + m.id + '">Seri</button>' : '<span></span>') +
        (!done ? '<button class="link-btn" data-act="notready" data-m="' + m.id + '">Ada yang belum siap?</button>' : '') +
      '</div>';
    return '<div class="court-wrap" data-mid="' + m.id + '">' +
      '<div class="court-meta"><span class="court-no">Lapangan ' + m.court + '</span>' +
      '<span class="court-state' + (done ? ' done' : '') + '">' + (done ? 'Selesai' : (past ? 'Tanpa hasil' : (state.scoring === 'simple' ? 'Ketuk sisi pemenang' : 'Isi skor'))) + '</span></div>' +
      '<div class="court">' + halfHTML(m, 'a', past) + halfHTML(m, 'b', past) + '</div>' + actions + '</div>';
  }

  function renderPlay(fresh) {
    if (!state) return;
    const { round, idx, past } = viewedRound();
    $('#round-title').textContent = 'Ronde ' + round.num;
    $('#round-chips').innerHTML = state.rounds.length > 1 ? state.rounds.map((r, i) =>
      '<button data-r="' + i + '" aria-current="' + (i === idx) + '" aria-label="Lihat ronde ' + r.num + '">' + r.num + '</button>').join('') : '';
    const chips = $('#round-chips'); chips.scrollLeft = chips.scrollWidth;
    $('#past-banner').hidden = !past;

    const courts = $('#courts');
    courts.classList.toggle('fresh', !!fresh);
    courts.innerHTML = round.matches.map(m => courtHTML(m, past)).join('') ||
      '<p class="muted">Tidak ada partai di ronde ini.</p>';

    // pemain istirahat
    const bench = $('#bench');
    if (past) {
      const playing = new Set(round.matches.flatMap(E.matchIds));
      const rested = state.players.filter(p => !playing.has(p.id)).map(p => p.id);
      bench.innerHTML = rested.length && round.matches.length ? '<b>Tidak main di ronde ini</b>' + rested.map(nameTag).join(', ') : '';
    } else {
      const nr = new Set(round.notReady || []);
      const rest = E.benchOf(state, round).filter(id => !nr.has(id));
      const nrList = (round.notReady || []).filter(id => playerById(id)?.active);
      bench.innerHTML = (rest.length || nrList.length)
        ? '<b>Istirahat ronde ini</b>' + (rest.length ? rest.map(nameTag).join(', ') : '<span class="muted">Tidak ada</span>') +
          (nrList.length ? '<div class="nr">Belum siap: ' + nrList.map(nameTag).join(', ') + '</div>' : '')
        : '';
    }
    renderPlayFoot();
    $('#sync-status').hidden = false;
    if (!dirty && state.id) setSync('ok', 'Tersimpan');
    else if (!state.id && !dirty) setSync('off', 'Belum tersimpan ke server');
  }

  function renderPlayFoot() {
    const { round, past } = viewedRound();
    const btn = $('#btn-next');
    const hint = $('#play-hint');
    btn.textContent = 'Acak ronde ' + (state.rounds.length + 1);
    if (past) { hint.textContent = ''; btn.disabled = true; return; }
    const total = round.matches.length;
    const doneN = round.matches.filter(m => m.result !== null).length;
    const enough = E.activePlayers(state).length >= E.perMatch(state);
    hint.className = 'foot-note' + (enough ? '' : ' warn');
    hint.textContent = !enough ? 'Pemain aktif kurang untuk satu lapangan. Tambah pemain lewat Menu.'
      : doneN === total ? 'Semua lapangan selesai. Siap acak ronde berikutnya.'
      : (total - doneN) + ' lapangan belum ada hasil.';
    btn.disabled = !(enough && doneN === total);
  }

  // perbarui tampilan satu lapangan tanpa render ulang (supaya fokus input skor tidak hilang)
  function refreshCourtVisual(mid) {
    const m = E.currentRound(state).matches.find(x => x.id === mid);
    const wrap = document.querySelector('.court-wrap[data-mid="' + mid + '"]');
    if (!m || !wrap) return;
    ['a', 'b'].forEach(side => {
      const h = wrap.querySelector('.half.' + side);
      h.classList.toggle('win', m.result === side);
      h.classList.toggle('lose', !!m.result && m.result !== side && m.result !== 'draw');
      h.classList.toggle('draw', m.result === 'draw');
    });
    const st = wrap.querySelector('.court-state');
    st.classList.toggle('done', m.result !== null);
    st.textContent = m.result !== null ? 'Selesai' : 'Isi skor';
    const nr = wrap.querySelector('[data-act="notready"]');
    if (nr) nr.hidden = m.result !== null;
    else if (m.result === null) renderPlay();
    renderPlayFoot();
  }

  function nextRound() {
    const res = E.startNextRound(state);
    if (!res.ok) { toast(res.error); return; }
    viewIdx = null;
    persist();
    draw(() => { renderPlay(true); window.scrollTo(0, 0); });
  }

  // ---------- sheet: belum siap ----------
  function openNotReady(mid) {
    const m = E.currentRound(state).matches.find(x => x.id === mid);
    if (!m) return;
    const canReshuffle = !E.roundHasResult(E.currentRound(state));
    openSheet('<h2 id="sheet-title">Siapa yang belum siap?</h2>' +
      '<p>Ia istirahat dulu di ronde ini dan diganti pemain cadangan. Ronde berikutnya ia ikut diacak lagi.</p>' +
      '<ul class="sheet-list">' + E.matchIds(m).map(id =>
        '<li><span class="name">' + nameTag(id) + '</span><button class="btn btn-ghost" data-act="replace" data-m="' + mid + '" data-p="' + id + '">Ganti</button></li>').join('') + '</ul>' +
      (canReshuffle ? '<button class="menu-btn" data-act="reshuffle">Acak ulang semua lapangan<small>Susun ulang seluruh ronde ini dari awal</small></button>' : '') +
      '<button class="btn btn-ghost btn-block" data-act="close" style="margin-top:12px">Batal</button>');
  }

  function doReplace(mid, pid) {
    const out = playerById(pid)?.name;
    const res = E.replacePlayer(state, mid, pid);
    if (!res.ok) { toast(res.error); return; }
    closeSheet(); persist(); renderPlay();
    toast(out + ' istirahat dulu, diganti ' + playerById(res.inId).name + '.');
  }

  function doReshuffle() {
    const res = E.reshuffleRound(state);
    if (!res.ok) { toast(res.error); return; }
    closeSheet(); persist();
    draw(() => renderPlay(true));
  }

  // ---------- sheet: menu ----------
  function openMenu() {
    const canReshuffle = !E.roundHasResult(E.currentRound(state));
    openSheet('<h2 id="sheet-title">' + esc(state.name || 'Turnamen') + '</h2><p>' + (state.mode === 'double' ? 'Ganda' : 'Tunggal') + ', ' + state.courts + ' lapangan</p>' +
      '<button class="menu-btn" data-act="players">Kelola pemain<small>Tambah pemain, keluarkan yang pulang, ganti L/P</small></button>' +
      '<button class="menu-btn" data-act="reshuffle"' + (canReshuffle ? '' : ' disabled') + '>Acak ulang ronde ini<small>' +
        (canReshuffle ? 'Susun ulang semua lapangan ronde sekarang' : 'Tidak bisa, sudah ada hasil di ronde ini') + '</small></button>' +
      '<button class="menu-btn" data-act="share">Bagikan link<small>Pemain lain bisa melihat lapangan dan klasemen dari HP masing-masing</small></button>' +
      '<button class="menu-btn" data-act="finish">Selesai dan lihat hasil<small>Bisa dilanjutkan lagi nanti</small></button>');
  }

  function openPlayers() {
    const rows = [...state.players].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    openSheet('<h2 id="sheet-title">Pemain</h2><p>Pemain baru langsung jadi cadangan dan ikut diacak di ronde berikutnya. Pemain yang keluar tetap tercatat di klasemen.</p>' +
      '<div class="add-player" style="margin-bottom:14px"><input id="sheet-new-name" type="text" placeholder="Nama pemain baru" autocomplete="off" maxlength="40">' +
      '<button class="gender-toggle" id="sheet-new-g" data-g="M" aria-label="Jenis kelamin: laki-laki">L</button>' +
      '<button class="btn btn-small" data-act="add-player">Tambah</button></div>' +
      '<ul class="sheet-list">' + rows.map(p =>
        '<li class="' + (p.active ? '' : 'out') + '"><span class="name">' + esc(p.name) + '</span>' +
        '<button class="gender-toggle" data-act="pg" data-p="' + p.id + '" data-g="' + p.gender + '" aria-label="Ganti jenis kelamin ' + esc(p.name) + '">' + (p.gender === 'F' ? 'P' : 'L') + '</button>' +
        (p.active ? '<button class="btn btn-danger" data-act="leave" data-p="' + p.id + '">Keluar</button>'
                  : '<button class="btn btn-ghost" data-act="rejoin" data-p="' + p.id + '">Main lagi</button>') +
        '</li>').join('') + '</ul>' +
      '<button class="btn btn-ghost btn-block" data-act="close">Selesai</button>');
  }

  function addPlayerFromSheet() {
    const input = $('#sheet-new-name');
    const g = $('#sheet-new-g').dataset.g;
    const res = E.addPlayer(state, input.value, g);
    if (!res.ok) { toast(res.error); input.focus(); return; }
    rememberPlayers([res.player]);
    persist(); renderPlay(); openPlayers();
    toast(res.player.name + ' masuk sebagai cadangan.');
  }

  function leavePlayer(pid) {
    const name = playerById(pid).name;
    const res = E.removePlayer(state, pid);
    persist(); renderPlay(); openPlayers();
    if (res.inId) toast(name + ' keluar, diganti ' + playerById(res.inId).name + '.');
    else if (res.cancelled) toast(name + ' keluar. Satu lapangan dibatalkan karena tidak ada cadangan.');
    else toast(name + ' keluar dari turnamen.');
  }

  // ---------- klasemen ----------
  function standingsTable() {
    const rows = E.standings(state);
    const scored = state.scoring === 'score';
    return '<table class="table"><thead><tr><th>#</th><th>Pemain</th><th>Main</th><th>M</th><th>S</th><th>K</th>' + (scored ? '<th>+/−</th>' : '') + '<th>Poin</th></tr></thead><tbody>' +
      rows.map((s, i) => '<tr class="' + (s.active ? '' : 'out') + '"><td class="rk">' + (i + 1) + '</td><td class="nm">' + esc(s.name) +
        (s.gender === 'F' ? '<span class="fbadge">P</span>' : '') + (s.active ? '' : ' <small>(keluar)</small>') + '</td><td>' + s.played + '</td><td>' + s.wins + '</td><td>' + s.draws +
        '</td><td>' + s.losses + '</td>' + (scored ? '<td>' + (s.diff > 0 ? '+' : '') + s.diff + '</td>' : '') + '<td class="pts">' + s.points + '</td></tr>').join('') +
      '</tbody></table><p class="small muted" style="margin-top:10px">Menang 3 poin, seri 1, kalah 0. Poin sama: dilihat jumlah menang, ' + (scored ? 'selisih skor, ' : '') + 'lalu yang lebih sedikit main.</p>';
  }
  function openStandings() {
    openSheet('<h2 id="sheet-title">Klasemen</h2><p>Setelah ' + state.rounds.filter(r => E.roundComplete(r)).length + ' ronde selesai</p>' + standingsTable() +
      '<button class="btn btn-ghost btn-block" data-act="close" style="margin-top:12px">Tutup</button>');
  }

  // ---------- hasil akhir ----------
  function finish() {
    state.status = 'finished';
    persist(); closeSheet(); renderSummary(); go('screen-summary'); setUrl(state.id);
  }
  function renderSummary() {
    const rows = E.standings(state).filter(s => s.played > 0);
    $('#summary-title').textContent = state.name || 'Hasil akhir';
    $('#summary-sub').textContent = state.rounds.length + ' ronde, ' + state.players.length + ' pemain, ' + (state.mode === 'double' ? 'ganda' : 'tunggal');
    $('#podium').innerHTML = rows.slice(0, 3).map((s, i) =>
      '<li><span class="pos">' + (i + 1) + '</span><span class="who">' + esc(s.name) + '<small>' + s.wins + ' menang dari ' + s.played + ' main</small></span><span class="pp">' + s.points + '</span></li>').join('') ||
      '<li><span class="pos">–</span><span class="who">Belum ada hasil<small>Catat pemenang di lapangan dulu</small></span><span></span></li>';
    $('#summary-table').innerHTML = rows.length ? standingsTable() : '';
  }

  async function share() {
    if (!state.id) { await sync(); }
    if (!state.id) { toast('Link tersedia setelah tersimpan ke server.'); return; }
    const url = location.origin + location.pathname + '?t=' + state.id;
    try {
      if (navigator.share) await navigator.share({ title: state.name || 'Droid Turnamen', url });
      else { await navigator.clipboard.writeText(url); toast('Link disalin.'); }
    } catch { /* dibatalkan */ }
  }

  // ---------- event ----------
  document.addEventListener('click', e => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { go(goBtn.dataset.go); return; }
  });
  $('#btn-new').onclick = startSetup;
  $('#btn-new-2').onclick = startSetup;
  $('#history-list').addEventListener('click', e => { const b = e.target.closest('.history-item'); if (b) openTournament(b.dataset.id); });

  // setup
  $('#new-gender').onclick = () => setNewGender(newGender === 'M' ? 'F' : 'M');
  $('#btn-add-name').onclick = () => {
    const v = $('#new-name').value;
    if (!v.trim()) { $('#new-name').focus(); return; }
    if (addDraftNames(v)) { $('#new-name').value = ''; setNewGender('M'); }
    renderSetup(); $('#new-name').focus();
  };
  $('#new-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#btn-add-name').click(); } });
  $('#new-name').addEventListener('input', renderSuggestions);
  $('#new-name').addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (/[,;\n]/.test(text)) { e.preventDefault(); addDraftNames(text); $('#new-name').value = ''; renderSetup(); }
  });
  $('#suggestions').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    draft.players.push({ name: c.dataset.name, gender: c.dataset.g });
    $('#new-name').value = '';
    renderSetup();
  });
  $('#roster').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.act === 'rm') draft.players.splice(i, 1);
    if (b.dataset.act === 'g') draft.players[i].gender = draft.players[i].gender === 'F' ? 'M' : 'F';
    renderSetup();
  });
  document.querySelectorAll('#screen-setup .seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = seg.dataset.setting;
    draft[k] = k === 'courts' ? Number(b.dataset.v) : b.dataset.v;
    renderSetup();
  }));
  $('#btn-start').onclick = startTournament;

  // main
  $('#courts').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const { act, m, side } = b.dataset;
    if (act === 'win') { E.setResult(state, m, side); persist(); renderPlay(); }
    if (act === 'draw') { E.setResult(state, m, 'draw'); persist(); renderPlay(); }
    if (act === 'notready') openNotReady(m);
  });
  $('#courts').addEventListener('input', e => {
    const inp = e.target.closest('.score-in'); if (!inp) return;
    E.setScore(state, inp.dataset.m, inp.dataset.side, inp.value);
    persist(); refreshCourtVisual(inp.dataset.m);
  });
  $('#round-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const i = Number(b.dataset.r);
    viewIdx = i === state.rounds.length - 1 ? null : i;
    renderPlay();
  });
  $('#btn-back-current').onclick = () => { viewIdx = null; renderPlay(); };
  $('#btn-next').onclick = nextRound;
  $('#btn-standings').onclick = openStandings;
  $('#btn-menu').onclick = openMenu;
  $('#btn-resume').onclick = () => { state.status = 'active'; persist(); viewIdx = null; renderPlay(); go('screen-play'); setUrl(state.id); };
  $('#btn-share-summary').onclick = share;

  // sheet
  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet') { closeSheet(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const { act, m, p } = b.dataset;
    if (act === 'close') closeSheet();
    if (act === 'replace') doReplace(m, p);
    if (act === 'reshuffle') doReshuffle();
    if (act === 'players') openPlayers();
    if (act === 'share') { closeSheet(); share(); }
    if (act === 'finish') finish();
    if (act === 'add-player') addPlayerFromSheet();
    if (act === 'leave') leavePlayer(p);
    if (act === 'rejoin') { playerById(p).active = true; persist(); renderPlay(); openPlayers(); toast(playerById(p).name + ' kembali sebagai cadangan.'); }
    if (act === 'pg') { const pl = playerById(p); pl.gender = pl.gender === 'F' ? 'M' : 'F'; rememberPlayers([pl]); persist(); renderPlay(); openPlayers(); }
  });
  $('#sheet').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Enter' && e.target.id === 'sheet-new-name') { e.preventDefault(); addPlayerFromSheet(); }
  });
  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet-new-g') {
      const b = e.target; const g = b.dataset.g === 'M' ? 'F' : 'M';
      b.dataset.g = g; b.textContent = g === 'F' ? 'P' : 'L';
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  // ---------- mulai ----------
  state = loadJSON(LS_CURRENT, null);
  if (state && !Array.isArray(state.rounds)) state = null;
  if (state && state.id == null && state.rounds.length) dirty = true; // belum pernah tersimpan ke server
  const sharedId = new URLSearchParams(location.search).get('t');
  if (sharedId) openTournament(sharedId);
  else renderHome();
  if (dirty) sync();
  refreshKnownPlayers();
})();
