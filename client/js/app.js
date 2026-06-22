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
      onDiscardClick,
      onMeldClick,
      orderHand,
    };
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
    if (!drag.moved && Math.abs(e.clientX - drag.startX) > 8) {
      drag.moved = true; drag.el.classList.add('dragging');
    }
  }
  function onHandPointerUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.onpointermove = d.el.onpointerup = d.el.onpointercancel = null;
    d.el.classList.remove('dragging');
    if (!d.moved) { onHandClick(d.id); return; }   // แตะเฉยๆ = เลือก
    // ลาก → หาตำแหน่งปลายทางจาก x แล้วย้าย id ใน handOrder
    const cards = [...document.querySelectorAll('#my-hand .card')];
    let idx = cards.length - 1;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { idx = i; break; }
    }
    const cur = handOrder.filter((x) => x !== d.id);
    cur.splice(Math.min(idx, cur.length), 0, d.id);
    handOrder = cur;
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
})();
