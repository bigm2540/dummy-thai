// render.js — วาด view (จาก server) ลง DOM · ไม่เก็บ state เอง (app.js ส่ง ctx มา)
const Render = (() => {
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SPETO = new Set(['C2', 'SQ']);
  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  // สร้าง element ไพ่ 1 ใบ
  function cardEl(c, { headId, small, selectable, selected, targetable } = {}) {
    const el = document.createElement('div');
    el.className = 'card' + (small ? ' sm' : '');
    if (c.suit === 'H' || c.suit === 'D') el.classList.add('red');
    if (SPETO.has(c.id)) el.classList.add('speto');
    if (headId && c.id === headId) el.classList.add('head');
    if (selectable) el.classList.add('selectable');
    if (selected) el.classList.add('selected');
    if (targetable) el.classList.add('targetable');
    el.dataset.id = c.id;
    el.innerHTML = `<span class="rk">${c.rank}</span><span class="st">${SUIT[c.suit]}</span>`;
    return el;
  }

  // ---------- ห้องรอ ----------
  function waiting(view) {
    showScreen('screen-waiting');
    $('room-code').textContent = view.code;
    const ul = $('waiting-players'); ul.innerHTML = '';
    view.players.forEach((p) => {
      const li = document.createElement('li');
      const host = p.id === view.hostId ? '<span class="host-badge">★ host</span>' : '';
      li.innerHTML = `<span>${p.name} ${host}</span>`;
      ul.appendChild(li);
    });
    const isHost = view.you === view.hostId;
    const full = view.players.length === 4;
    $('btn-start').classList.toggle('hidden', !(isHost && full));
    $('waiting-hint').textContent = full ? (isHost ? '' : 'รอ host กดเริ่ม') : `รอผู้เล่น (${view.players.length}/4)`;
  }

  // ---------- โต๊ะ ----------
  // จัดคู่ต่อสู้รอบตัวเรา: +1=right, +2=top, +3=left (วนตามเข็ม)
  function seatSlots(view) {
    const r = view.round;
    const n = r.playerIds.length;
    const mySeat = r.playerIds.indexOf(view.you);
    const slotFor = { 1: 'right', 2: 'top', 3: 'left' };
    const map = {};
    for (let off = 1; off < n; off++) {
      const seat = (mySeat + off) % n;
      map[slotFor[off]] = seat;
    }
    return map;
  }

  function meldBox(meld, headId, ctx) {
    const box = document.createElement('div');
    box.className = 'meld-box';
    if (ctx && ctx.meldTargetable) {
      box.classList.add('layoff-target');
      box.onclick = () => ctx.onMeldClick(meld.id);
    }
    meld.cards.forEach((mc) => box.appendChild(cardEl(mc.card, { headId, small: true })));
    return box;
  }

  function backEl() { const d = document.createElement('div'); d.className = 'card-back'; return d; }

  // หัวโซนผู้เล่น: avatar + ชื่อ + คะแนน + ตา + จำนวนไพ่ในมือ
  function zoneHead(p, isTurn, score, handCount, isHost, label) {
    const head = document.createElement('div'); head.className = 'zone-head';
    const av = document.createElement('div'); av.className = 'avatar' + (p && !p.connected ? ' off' : '');
    av.textContent = ((label || (p && p.name) || '?').trim()[0] || '?').toUpperCase();
    const who = document.createElement('div'); who.className = 'who';
    who.innerHTML = `<div class="nm">${label || p.name}${isHost ? ' <span class="host-badge">★</span>' : ''}</div>`
      + `<div class="sc">${fmt(score)}</div>`;
    head.appendChild(av); head.appendChild(who);
    if (isTurn) { const t = document.createElement('span'); t.className = 'turn-tag'; t.textContent = 'ตา'; head.appendChild(t); }
    const cnt = document.createElement('div'); cnt.className = 'cnt';
    cnt.innerHTML = `ไพ่ <span class="pill">${handCount}</span>`;
    head.appendChild(cnt);
    return head;
  }

  function renderSeat(slot, seatIdx, view, ctx) {
    const r = view.round;
    const box = document.querySelector(`.seat-${slot}`);
    if (!box) return;
    const pid = r.playerIds[seatIdx];
    const p = view.players.find((x) => x.id === pid);
    const isTurn = r.currentSeat === seatIdx && r.status === 'PLAYING';
    const mine = r.melds.filter((m) => m.ownerId === pid);
    box.classList.toggle('active', isTurn);
    box.classList.toggle('empty', mine.length === 0);
    box.innerHTML = '';

    box.appendChild(zoneHead(p, isTurn, r.scores[pid], r.handCounts[pid], pid === view.hostId));

    const melds = document.createElement('div'); melds.className = 'melds';
    mine.forEach((m) => melds.appendChild(meldBox(m, r.headId, ctx)));
    box.appendChild(melds);
  }

  function table(view, ctx) {
    showScreen('screen-table');
    const r = view.round;
    const slots = seatSlots(view);
    Object.entries(slots).forEach(([slot, seatIdx]) => renderSeat(slot, seatIdx, view, ctx));

    // กองจั่ว
    $('stock-count').textContent = `เหลือ ${r.stockCount}`;

    // กองทิ้ง (ทุกใบ): โหมด pick = แตะเลือกเป้าหมาย · โหมด pickPlan = ใบเหนือเป้าหมายแตะเลือกมาเข้าชุดได้
    const dp = $('discard-pile'); dp.innerHTML = '';
    r.discard.forEach((c, i) => {
      const isTarget = ctx.mode === 'pickPlan' && i === ctx.pickTarget;
      const aboveTarget = ctx.mode === 'pickPlan' && i > ctx.pickTarget;
      const el = cardEl(c, {
        headId: r.headId, small: true,
        targetable: ctx.mode === 'pick',
        selected: aboveTarget && ctx.selected.has(c.id),
      });
      if (isTarget) el.classList.add('target');
      if (ctx.mode === 'pick' || aboveTarget) { el.classList.add('selectable'); el.onclick = () => ctx.onDiscardClick(i); }
      dp.appendChild(el);
    });

    // โซนของเรา: หัว + ไพ่ที่เราเกิด (อยู่บนกระดาน แยกจากแถบไพ่มือ → ปุ่มไม่ถูกดันตกจอ)
    const me = view.players.find((x) => x.id === view.you);
    const mySeat = r.playerIds.indexOf(view.you);
    const yourTurn = r.currentSeat === mySeat;
    const mine = r.melds.filter((m) => m.ownerId === view.you);
    const myZone = $('my-zone');
    myZone.classList.toggle('active', yourTurn && r.status === 'PLAYING');
    myZone.classList.toggle('empty', mine.length === 0);
    const myHead = $('my-head'); myHead.innerHTML = '';
    myHead.appendChild(zoneHead(me, yourTurn && r.status === 'PLAYING', r.scores[view.you], r.yourHand.length, me.id === view.hostId, 'คุณ'));
    const myMelds = $('my-melds'); myMelds.innerHTML = '';
    mine.forEach((m) => myMelds.appendChild(meldBox(m, r.headId, ctx)));
    $('status-bar').innerHTML =
      `ห้อง <b>${view.code}</b> · ตาที่ <b>${r.turnNo}</b> · ${yourTurn ? '<b>ตาคุณ!</b>' : 'รอตาคุณ'} · ` +
      `ช่วง <b>${r.phase === 'DRAW' ? 'จั่ว/เก็บ' : 'ลงไพ่/ทิ้ง'}</b> · คะแนนคุณ <b>${fmt(r.scores[view.you])}</b>` +
      (r.lastTurn ? ' · <b>⚠️ ตาสุดท้าย (กองหมด)</b>' : '');

    // มือเรา (เรียงตามที่ผู้เล่นจัดเอง + รองรับลากสลับ)
    const hand = $('my-hand'); hand.innerHTML = '';
    const ordered = ctx.orderHand ? ctx.orderHand(r.yourHand) : r.yourHand;
    ordered.forEach((c) => {
      const el = cardEl(c, { headId: r.headId, small: false, selectable: true, selected: ctx.selected.has(c.id) });
      el.onpointerdown = (e) => ctx.onHandPointerDown(e, c.id, el); // ลาก=จัดเรียง / แตะ=เลือก
      hand.appendChild(el);
    });
  }

  // ---------- สรุป ----------
  function summary(view) {
    showScreen('screen-summary');
    const match = view.status === 'FINISHED';
    $('summary-title').textContent = match ? '🏆 จบแมตช์ — สรุปเงิน' : 'สรุปรอบ';
    const t = $('summary-table');
    if (match) {
      t.innerHTML = '<tr><th>ผู้เล่น</th><th>คะแนนสะสม</th><th>เงิน</th></tr>' +
        view.finalSummary.map((row) =>
          `<tr><td>${nm(view, row.playerId)}</td><td class="${cls(row.totalScore)}">${fmt(row.totalScore)}</td>` +
          `<td class="${cls(row.money)}">${fmt(row.money)}฿</td></tr>`).join('');
    } else {
      const s = view.lastSummary;
      t.innerHTML = '<tr><th>ผู้เล่น</th><th>รอบนี้</th><th>สะสม</th><th>ที่มา</th></tr>' +
        s.rows.map((row) => {
          const win = row.playerId === s.winnerId ? ' class="win"' : '';
          const bd = row.breakdown.map((b) => `${b.note} (${fmt(b.amount)})`).join(', ') || '—';
          return `<tr><td${win}>${row.name}</td><td class="${cls(row.roundScore)}">${fmt(row.roundScore)}</td>` +
            `<td>${fmt(row.totalScore)}</td><td class="breakdown">${bd}</td></tr>`;
        }).join('');
    }
    // ปุ่ม
    const acts = $('summary-actions'); acts.innerHTML = '';
    const isHost = view.you === view.hostId;
    if (match) {
      const nm = isHost ? '<button id="btn-newmatch" class="primary">เริ่มแมตช์ใหม่</button>' : '';
      acts.innerHTML = nm + '<button id="btn-leave-summary">ออกจากห้อง</button>';
    } else if (isHost) {
      acts.innerHTML = `<button id="btn-next" class="primary">เริ่มรอบใหม่</button>
        <button id="btn-close" class="danger">ปิดห้อง (จบแมตช์)</button>`;
    } else {
      acts.innerHTML = '<span class="hint">รอ host เริ่มรอบใหม่…</span>';
    }
  }

  function fmt(n) { n = n || 0; return n > 0 ? `+${n}` : `${n}`; }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  function nm(view, pid) { const p = view.players.find((x) => x.id === pid); return p ? p.name : pid; }

  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  return { showScreen, waiting, table, summary, toast };
})();
