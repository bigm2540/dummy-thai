// app.js — ตัวควบคุม: ปุ่ม lobby, เลือกไพ่, โหมดเก็บกอง/ฝาก, route จอ, reconnect
(() => {
  const $ = (id) => document.getElementById(id);

  let view = null;            // room view ล่าสุด
  const selected = new Set(); // ไพ่ในมือที่เลือก
  let mode = 'idle';          // idle | pick | pickPlan | pickLayoff | layoff
  let pickTarget = null;      // index ใบเป้าหมายในกองทิ้ง
  let layoffCardId = null;    // ไพ่ที่จะฝาก (โหมด layoff)
  let handOrder = [];         // ลำดับไพ่ในมือที่ผู้เล่นจัดเอง (ลากสลับ — client เท่านั้น)
  let drag = null;            // สถานะลากไพ่
  let selectedRate = 1;       // เรทเงินที่เลือกตอนสร้างห้อง

  function reset() { selected.clear(); mode = 'idle'; pickTarget = null; layoffCardId = null; }

  // เรียงไพ่ในมือตามที่ผู้เล่นจัด (ไพ่ใหม่ต่อท้าย, ไพ่ที่หายเอาออก)
  function orderHand(cards) {
    const ids = cards.map((c) => c.id);
    handOrder = handOrder.filter((id) => ids.includes(id));
    for (const id of ids) if (!handOrder.includes(id)) handOrder.push(id);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    return handOrder.map((id) => byId[id]);
  }

  // ---------- ส่ง action ----------
  async function act(type, payload) {
    const res = await Net.emit('game:action', { type, payload });
    if (!res || !res.ok) Render.toast(res?.error || 'ทำรายการไม่ได้');
    else reset();
    // room:update จะวาดใหม่ให้เอง
    if (res && res.ok) draw();
  }

  // ---------- ctx ที่ส่งให้ render ----------
  function ctx() {
    return {
      selected, mode, pickTarget,
      meldTargetable: mode === 'layoff' || mode === 'pickLayoff',
      onHandClick,
      onHandPointerDown,
      onHandSlotClick,
      onDiscardClick,
      onMeldClick,
      orderHand,
    };
  }

  // แตะช่อง ＋ = ย้ายไพ่ที่เลือก (1 ใบ) มาตำแหน่งนี้ (คงการเลือกไว้ → ช่องอัปเดตตาม)
  function onHandSlotClick(pos) {
    if (selected.size !== 1) return;
    const id = [...selected][0];
    const from = handOrder.indexOf(id);
    if (from < 0) return;
    handOrder.splice(from, 1);
    let to = pos; if (to > from) to -= 1; if (to < 0) to = 0;
    handOrder.splice(to, 0, id);
    draw();
  }

  // เรียงไพ่ในมืออัตโนมัติ (ตามดอก หรือ ตามเลข)
  function rankVal(rank) {
    return { A: 14, K: 13, Q: 12, J: 11, '10': 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 }[rank] || 0;
  }
  function sortHand(by) {
    if (!view || !view.round) return;
    const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
    const cards = view.round.yourHand.slice();
    cards.sort((a, b) => (by === 'suit'
      ? (suitOrder[a.suit] - suitOrder[b.suit]) || (rankVal(b.rank) - rankVal(a.rank))
      : (rankVal(b.rank) - rankVal(a.rank)) || (suitOrder[a.suit] - suitOrder[b.suit])));
    handOrder = cards.map((c) => c.id);
    draw();
  }

  function onHandClick(id) {
    if (mode !== 'idle' && mode !== 'pickPlan') return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    draw();
  }

  // ลากสลับไพ่ในมือ (pointer = mouse+touch); แตะสั้น = เลือก, ลาก = จัดเรียง
  function onHandPointerDown(e, id, el) {
    drag = { id, el, startX: e.clientX, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* */ }
    el.onpointermove = onHandPointerMove;
    el.onpointerup = onHandPointerUp;
    el.onpointercancel = onHandPointerUp;
  }
  function onHandPointerMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) > 5) {
      drag.moved = true; drag.el.classList.add('dragging');
    }
    if (!drag.moved) return;
    // สลับช่องสดๆ ตามตำแหน่งนิ้ว (insertBefore ใน DOM — draw() ยังไม่ถูกเรียกระหว่างลาก)
    const hand = document.getElementById('my-hand');
    const cards = [...hand.querySelectorAll('.card')];
    let ref = null;
    for (const c of cards) {
      if (c === drag.el) continue;
      const r = c.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { ref = c; break; }
    }
    if (ref !== drag.el) hand.insertBefore(drag.el, ref);
    // ไพ่ลอยตามนิ้ว (ยกขึ้น + ขยายนิด)
    const rc = drag.el.getBoundingClientRect();
    drag.el.style.transform = `translate(${e.clientX - (rc.left + rc.width / 2)}px,-18px) scale(1.07)`;
  }
  function onHandPointerUp() {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.onpointermove = d.el.onpointerup = d.el.onpointercancel = null;
    d.el.classList.remove('dragging');
    d.el.style.transform = '';                      // สแน็ปกลับเข้าช่องนุ่มๆ
    if (!d.moved) { onHandClick(d.id); return; }    // แตะเฉยๆ = เลือก
    // commit ลำดับใหม่จาก DOM → handOrder
    handOrder = [...document.querySelectorAll('#my-hand .card')].map((c) => c.dataset.id);
    draw();
  }
  function onDiscardClick(i) {
    if (mode === 'pick') { pickTarget = i; mode = 'pickPlan'; draw(); return; }
    if (mode === 'pickPlan') {
      if (i <= pickTarget) return;                 // เลือกได้เฉพาะใบ "เหนือ" เป้าหมาย (ที่จะขุดติดมา)
      const id = view.round.discard[i].id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      draw();
    }
  }
  function onMeldClick(meldId) {
    if (mode === 'layoff') act('LAYOFF', { cardId: layoffCardId, meldId });
    else if (mode === 'pickLayoff') act('PICK_DISCARD', { targetIndex: pickTarget, plan: { layoffMeldId: meldId } });
  }

  // ---------- แถบปุ่ม ----------
  function btn(label, fn, { primary, disabled, danger } = {}) {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.classList.add('primary');
    if (danger) b.classList.add('danger');
    b.disabled = !!disabled;
    b.onclick = fn;
    return b;
  }

  function buildActions() {
    const bar = $('action-bar'); bar.innerHTML = '';
    const hint = $('hint-bar'); hint.textContent = '';
    const r = view.round;
    const allowed = r.allowedActions;
    const add = (...els) => els.forEach((e) => bar.appendChild(e));

    if (mode === 'pick') {
      hint.textContent = 'แตะไพ่ "เป้าหมาย" ในกองทิ้ง (จะขุดตั้งแต่ใบนั้นขึ้นมา)';
      add(btn('ยกเลิก', () => { reset(); draw(); }));
      return;
    }
    if (mode === 'pickPlan') {
      hint.textContent = 'เลือกไพ่ในมือ (และไพ่ในกองเหนือเป้าหมายได้) มาเข้าชุดกับใบเป้าหมาย แล้วกด "เกิด" หรือกด "ฝาก"';
      add(
        btn(`เกิดด้วยไพ่ที่เลือก (${selected.size})`,
          () => act('PICK_DISCARD', { targetIndex: pickTarget, plan: { meldCardIds: [...selected] } }),
          { primary: true, disabled: selected.size < 2 }),
        btn('ฝากเข้าชุด', () => { mode = 'pickLayoff'; draw(); }),
        btn('ยกเลิก', () => { reset(); draw(); }),
      );
      return;
    }
    if (mode === 'pickLayoff' || mode === 'layoff') {
      hint.textContent = 'แตะ "ชุด" ที่จะฝากเข้าไป (ของตัวเองหรือคนอื่น)';
      add(btn('ยกเลิก', () => { reset(); draw(); }));
      return;
    }

    // idle — ปุ่มตาม allowedActions
    if (allowed.includes('SHOW_SPETO')) add(btn('โชว์สเปโต ★', () => act('SHOW_SPETO')));
    if (allowed.includes('DRAW_STOCK')) add(btn('จั่วกอง', () => act('DRAW_STOCK'), { primary: true }));
    if (allowed.includes('PICK_DISCARD')) add(btn('เก็บกอง', () => { reset(); mode = 'pick'; draw(); }));
    if (allowed.includes('PASS')) add(btn('ผ่าน (จบรอบ)', () => act('PASS'), { danger: true }));
    if (allowed.includes('MELD')) add(btn(`เกิด (${selected.size})`, () => act('MELD', { cardIds: [...selected] }), { primary: true, disabled: selected.size < 3 }));
    if (allowed.includes('LAYOFF')) add(btn('ฝาก', () => {
      if (selected.size !== 1) { Render.toast('เลือกไพ่ 1 ใบเพื่อฝาก'); return; }
      layoffCardId = [...selected][0]; mode = 'layoff'; draw();
    }, { disabled: selected.size !== 1 }));
    if (allowed.includes('DISCARD')) add(btn('ทิ้ง', () => {
      if (selected.size !== 1) { Render.toast('เลือกไพ่ 1 ใบเพื่อทิ้ง'); return; }
      act('DISCARD', { cardId: [...selected][0] });
    }, { disabled: selected.size !== 1 }));
    if (allowed.includes('KNOCK')) add(btn('น็อค! 🏆', () => act('KNOCK', { faceDownCardId: r.yourHand[0].id }), { primary: true }));

    // hint กฎ "เปิดครั้งแรกต้องเก็บกอง"
    if (r.openedFromHand) {
      hint.textContent = '⚠️ เปิดจากมือแล้ว — ตานี้ต้องน็อคให้ได้ (ทิ้งไม่ได้)';
    } else if (!r.youMelded && r.phase === 'ACTION') {
      hint.textContent = 'เปิดครั้งแรกต้องเก็บกอง/หัว — จั่วแล้วเกิดจากมือได้เฉพาะถ้าจะน็อคมืด';
    }
    if (!bar.children.length && !hint.textContent) hint.textContent = 'รอตาคุณ…';
  }

  // ---------- route จอ ----------
  function draw() {
    if (!view) return;
    if (view.status === 'FINISHED') { Render.summary(view); return; }
    if (view.status === 'WAITING') { Render.waiting(view); return; }
    if (view.awaitingNextRound) { Render.summary(view); return; }
    // PLAYING
    Render.table(view, ctx());
    buildActions();
  }

  // ---------- socket events ----------
  Net.on('room:update', (v) => {
    const prevRoundEnded = view?.awaitingNextRound;
    view = v;
    if (prevRoundEnded && !v.awaitingNextRound) reset(); // เริ่มรอบใหม่ → เคลียร์ที่เลือก
    draw();
  });
  Net.on('peer:graceExpired', ({ playerId }) => {
    if (view && view.you === view.hostId) {
      const p = view.players.find((x) => x.id === playerId);
      $('dc-text').textContent = `${p ? p.name : playerId} หลุดเกินเวลา — จะทำยังไง?`;
      $('dc-popup').classList.remove('hidden');
    }
  });
  Net.on('disconnect', () => Render.toast('การเชื่อมต่อหลุด — กำลังต่อใหม่…'));
  Net.on('connect', () => { /* reconnect handled below */ });

  // ---------- lobby ----------
  let sessionToken = null;
  async function createRoom() {
    const name = $('name-input').value.trim() || 'ผู้เล่น';
    const res = await Net.emit('room:create', { name, moneyRate: selectedRate });
    if (!res.ok) return Render.toast(res.error);
    sessionToken = res.token; Net.saveSession(res.code, res.token);
  }
  async function joinRoom() {
    const name = $('name-input').value.trim() || 'ผู้เล่น';
    const code = $('code-input').value.trim().toUpperCase();
    if (code.length !== 4) return Render.toast('ใส่รหัสห้อง 4 ตัว');
    const res = await Net.emit('room:join', { code, name });
    if (!res.ok) return Render.toast(res.error);
    sessionToken = res.token; Net.saveSession(code, res.token);
  }

  // ออกจากห้อง (ได้เฉพาะตอนรอเริ่ม/จบแมตช์ — server บังคับ) → ล้าง session กลับล็อบบี้
  async function leaveRoom() {
    const res = await Net.emit('room:leave', {});
    if (res && res.ok) {
      Net.clearSession(); view = null; reset();
      Render.showScreen('screen-lobby');
    } else {
      Render.toast(res?.error || 'ออกจากห้องไม่ได้');
    }
  }

  // ---------- แชร์ลิงก์ห้อง ----------
  // ลิงก์ชวนเพื่อน: เปิดแล้วจะเติมรหัสห้องให้อัตโนมัติ (ดู initRoomParam ด้านล่าง)
  function roomLink() {
    const code = (view && view.code) || '';
    return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  }
  function copyText(text) {
    const legacy = () => new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy'); document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => legacy()); // เผื่อ API ถูกปฏิเสธ (เช่น แท็บไม่โฟกัส) → ใช้วิธีเดิม
    }
    return legacy();
  }
  async function shareLink() {
    const code = view && view.code;
    if (!code) return Render.toast('ยังไม่มีห้อง');
    const url = roomLink();
    const text = `มาเล่นดัมมี่ไทยกัน! ห้อง ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ดัมมี่ไทย 🎴', text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* ไม่รองรับ → fallback คัดลอก */ }
    }
    copyLink();
  }
  async function copyLink() {
    const code = view && view.code;
    if (!code) return Render.toast('ยังไม่มีห้อง');
    try { await copyText(roomLink()); Render.toast('คัดลอกลิงก์ห้องแล้ว ✓ ส่งให้เพื่อนได้เลย'); }
    catch { Render.toast('คัดลอกไม่ได้ — ลิงก์: ' + roomLink()); }
  }

  // เลือกเรทเงิน (ล็อบบี้)
  $('rate-opts').addEventListener('click', (e) => {
    const b = e.target.closest('.rate-opt'); if (!b) return;
    selectedRate = Number(b.dataset.rate);
    [...document.querySelectorAll('.rate-opt')].forEach((x) => x.classList.toggle('active', x === b));
  });

  // ดูเงิน/คะแนนสะสม (รวมรอบสด) ได้ตลอด
  function openMoney() {
    if (!view) return;
    const r = view.round; const rate = view.moneyRate || 1;
    $('money-table').innerHTML = '<tr><th>ผู้เล่น</th><th>คะแนน (รวมรอบสด)</th><th>เงิน</th></tr>' +
      view.players.map((p) => {
        const total = (p.totalScore || 0) + ((r && r.scores[p.id]) || 0);
        return `<tr><td>${p.name}</td><td class="${total>0?'pos':total<0?'neg':''}">${total>0?'+':''}${total}</td>` +
          `<td>${total * rate}฿</td></tr>`;
      }).join('');
    $('money-popup').classList.remove('hidden');
  }
  $('btn-money').onclick = openMoney;
  $('money-close').onclick = () => $('money-popup').classList.add('hidden');

  $('btn-create').onclick = createRoom;
  $('btn-join').onclick = joinRoom;
  $('btn-leave').onclick = leaveRoom;
  $('btn-share').onclick = shareLink;
  $('btn-copy-link').onclick = copyLink;
  $('btn-sort-suit').onclick = () => sortHand('suit');
  $('btn-sort-rank').onclick = () => sortHand('rank');
  $('btn-start').onclick = () => Net.emit('room:start', {}).then((r) => { if (!r.ok) Render.toast(r.error); });

  // ปุ่มในจอสรุป (สร้าง dynamic — ผูกด้วย delegation)
  document.addEventListener('click', (e) => {
    if (e.target.id === 'btn-next') Net.emit('round:next', {}).then((r) => { if (!r.ok) Render.toast(r.error); });
    if (e.target.id === 'btn-close') Net.emit('room:close', {}).then((r) => { if (!r.ok) Render.toast(r.error); });
    if (e.target.id === 'btn-leave-summary') leaveRoom();
    if (e.target.id === 'btn-newmatch') Net.emit('room:newMatch', {}).then((r) => { if (!r.ok) Render.toast(r.error); });
  });
  $('dc-wait').onclick = () => { $('dc-popup').classList.add('hidden'); Net.emit('peer:resolve', { decision: 'wait' }); };
  $('dc-end').onclick = () => { $('dc-popup').classList.add('hidden'); Net.emit('peer:resolve', { decision: 'end' }); };

  // ---------- reconnect ตอนเปิดหน้า ----------
  async function tryReconnect() {
    const s = Net.loadSession();
    if (!s || !s.code || !s.token) return;
    const res = await Net.emit('room:rejoin', { code: s.code, token: s.token });
    if (res.ok) { sessionToken = res.token; }
    else { Net.clearSession(); Render.toast('กลับเข้าห้องเดิมไม่ได้ — เริ่มใหม่'); }
  }
  // รอ socket เชื่อมก่อนค่อย rejoin
  Net.on('connect', tryReconnect);

  // ---------- เปิดจากลิงก์ชวนเพื่อน (?room=CODE) → เติมรหัสห้องให้ ----------
  (function initRoomParam() {
    try {
      const raw = new URLSearchParams(location.search).get('room');
      if (!raw) return;
      const code = raw.trim().toUpperCase().slice(0, 4);
      if (!code) return;
      const ci = $('code-input'); if (ci) ci.value = code;
      const ni = $('name-input'); if (ni) ni.focus();
      Render.toast(`เข้าห้อง ${code} — ใส่ชื่อแล้วกด “เข้าห้อง”`);
    } catch { /* ignore */ }
  })();
})();
