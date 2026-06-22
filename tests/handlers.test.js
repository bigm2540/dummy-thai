// เทส M5 ขั้น 2: socket/handlers.js ด้วย fake io (ไม่เปิดเน็ตจริง — เทส wiring/broadcast/reconnect)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/socket/handlers.js';

// ---------- fake Socket.IO ----------
function makeFakeIo() {
  const emitted = new Map();   // sid -> [{event, data}]
  let connHandler = null;
  const io = {
    on(ev, fn) { if (ev === 'connection') connHandler = fn; },
    to(sid) {
      return { emit(event, data) {
        if (!emitted.has(sid)) emitted.set(sid, []);
        emitted.get(sid).push({ event, data });
      } };
    },
    _emitted: emitted,
    _connect(id) {
      const handlers = new Map();
      const socket = {
        id, data: {},
        on(ev, fn) { handlers.set(ev, fn); },
        fire(ev, payload, cb) {
          const fn = handlers.get(ev);
          if (!fn) throw new Error(`ไม่มี handler: ${ev}`);
          return fn(payload, cb);
        },
      };
      connHandler(socket);
      return socket;
    },
  };
  return io;
}
// callback ตัวสุดท้ายที่ handler เรียก
function call(socket, ev, payload) {
  let res;
  socket.fire(ev, payload, (v) => { res = v; });
  return res;
}
// room:update ล่าสุดที่ส่งให้ sid นี้
function lastUpdate(io, sid) {
  const arr = io._emitted.get(sid) || [];
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].event === 'room:update') return arr[i].data;
  return null;
}
function emitsTo(io, sid, event) {
  return (io._emitted.get(sid) || []).filter((e) => e.event === event);
}

// สร้างห้องครบ 4 คน คืน { io, server, sockets, code }
function setupRoom() {
  const io = makeFakeIo();
  const server = createGameServer(io);
  const s1 = io._connect('sid1');
  const r = call(s1, 'room:create', { name: 'A' });
  const code = r.code;
  const s2 = io._connect('sid2'); call(s2, 'room:join', { code, name: 'B' });
  const s3 = io._connect('sid3'); call(s3, 'room:join', { code, name: 'C' });
  const s4 = io._connect('sid4'); call(s4, 'room:join', { code, name: 'D' });
  return { io, server, sockets: { s1, s2, s3, s4 }, code, tokens: {
    A: r.token,
  } };
}

test('create+join: ได้ code/token/playerId + broadcast ครบ 4 คน', () => {
  const io = makeFakeIo();
  createGameServer(io);
  const s1 = io._connect('sid1');
  const r = call(s1, 'room:create', { name: 'A' });
  assert.equal(r.ok, true);
  assert.ok(r.code && r.token && r.playerId === 'p1');
  const s2 = io._connect('sid2');
  const j = call(s2, 'room:join', { code: r.code, name: 'B' });
  assert.equal(j.ok, true);
  assert.equal(j.playerId, 'p2');
  // ทั้งคู่ได้ room:update และเห็น 2 ผู้เล่น
  assert.equal(lastUpdate(io, 'sid1').players.length, 2);
  assert.equal(lastUpdate(io, 'sid2').you, 'p2');
});

test('join ห้องไม่มีจริง → callback error', () => {
  const io = makeFakeIo();
  createGameServer(io);
  const s = io._connect('sid1');
  const j = call(s, 'room:join', { code: 'NOPE', name: 'X' });
  assert.equal(j.ok, false);
  assert.match(j.error, /ไม่พบห้อง/);
});

test('start: เฉพาะ host + broadcast view เกม (มือลับเฉพาะตัว)', () => {
  const { io, sockets, code } = setupRoom();
  // ไม่ใช่ host → error
  const bad = call(sockets.s2, 'room:start', {});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /host/);
  // host เริ่มได้
  const ok = call(sockets.s1, 'room:start', {});
  assert.equal(ok.ok, true);
  const v1 = lastUpdate(io, 'sid1');
  const v2 = lastUpdate(io, 'sid2');
  assert.equal(v1.status, 'PLAYING');
  assert.ok(v1.round.yourHand.length >= 7);     // เห็นมือตัวเอง
  assert.equal(v1.round.hands, undefined);        // ไม่เห็นมือดิบ
  // มือของ p1 (ที่ s1 เห็น) ต้องไม่ใช่มือของ p2 (ที่ s2 เห็น)
  assert.notDeepEqual(v1.round.yourHand, v2.round.yourHand);
  assert.equal(v2.round.you, 'p2');
  assert.ok(!JSON.stringify(v1).includes('token')); // ไม่หลุด token
});

test('game:action: จั่ว→ทิ้ง เลื่อนตา + broadcast อัปเดตทุกคน', () => {
  const { io, sockets } = setupRoom();
  call(sockets.s1, 'room:start', {});
  const draw = call(sockets.s1, 'game:action', { type: 'DRAW_STOCK' });
  assert.equal(draw.ok, true);
  const v1 = lastUpdate(io, 'sid1');
  const cardId = v1.round.yourHand[0].id;
  const disc = call(sockets.s1, 'game:action', { type: 'DISCARD', payload: { cardId } });
  assert.equal(disc.ok, true);
  assert.equal(lastUpdate(io, 'sid2').round.currentSeat, 1); // ถึงตา p2
});

test('game:action ผิดตา → error (engine ปฏิเสธ)', () => {
  const { sockets } = setupRoom();
  call(sockets.s1, 'room:start', {});
  const bad = call(sockets.s2, 'game:action', { type: 'DRAW_STOCK' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ตาคุณ/);
});

test('disconnect ตอน WAITING → mark offline (ยังอยู่), เกิน grace ค่อยเอาออก', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { io, sockets } = setupRoom();
  sockets.s4.fire('disconnect');
  let v = lastUpdate(io, 'sid1');
  assert.equal(v.players.length, 4);                              // ยังอยู่ครบ (ไม่ลบทันที)
  assert.equal(v.players.find((p) => p.id === 'p4').connected, false); // แต่ offline
  t.mock.timers.tick(60_000);                                     // เกิน grace
  v = lastUpdate(io, 'sid1');
  assert.equal(v.players.length, 3);                              // ค่อยถูกเอาออก
});

test('BUG fix: หลุดตอนรอ + rejoin ใน grace → ห้องไม่พัง (host กลับมา online)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const io = makeFakeIo();
  createGameServer(io);
  const s1 = io._connect('sid1'); const r = call(s1, 'room:create', { name: 'A' });
  const code = r.code;
  const s2 = io._connect('sid2'); call(s2, 'room:join', { code, name: 'B' });
  // host หลุดแว้บเดียว
  s1.fire('disconnect');
  assert.equal(lastUpdate(io, 'sid2').players.length, 2);                                // ห้องไม่พัง
  assert.equal(lastUpdate(io, 'sid2').players.find((p) => p.id === 'p1').connected, false);
  // host กลับมาใน grace ด้วย token เดิม (socket ใหม่)
  const s1b = io._connect('sid1b');
  const re = call(s1b, 'room:rejoin', { code, token: r.token });
  assert.equal(re.ok, true); assert.equal(re.playerId, 'p1');
  assert.equal(lastUpdate(io, 'sid2').players.find((p) => p.id === 'p1').connected, true);
  // grace เดิม fire → ไม่เอา host ออก (กลับมาแล้ว)
  t.mock.timers.tick(60_000);
  const v = lastUpdate(io, 'sid2');
  assert.equal(v.players.length, 2);
  assert.ok(v.players.find((p) => p.id === 'p1'));
});

test('room:leave: ออกตอนรอเริ่ม → ถูกเอาออก (เหลือ 3)', () => {
  const { io, sockets } = setupRoom();
  const res = call(sockets.s4, 'room:leave');
  assert.equal(res.ok, true);
  assert.equal(lastUpdate(io, 'sid1').players.length, 3);
});

test('room:leave: กลางเกม → ปฏิเสธ', () => {
  const { sockets } = setupRoom();
  call(sockets.s1, 'room:start', {});
  const res = call(sockets.s2, 'room:leave');
  assert.equal(res.ok, false);
  assert.match(res.error, /กลางเกม/);
});

test('room:newMatch: host เริ่มใหม่หลังจบแมตช์ → กลับห้องรอ (คะแนนรีเซ็ต)', () => {
  const { io, sockets } = setupRoom();
  call(sockets.s1, 'room:start', {});
  call(sockets.s1, 'room:close', {});                 // จบแมตช์
  const bad = call(sockets.s2, 'room:newMatch');       // ไม่ใช่ host
  assert.equal(bad.ok, false);
  const res = call(sockets.s1, 'room:newMatch');       // host
  assert.equal(res.ok, true);
  const v = lastUpdate(io, 'sid1');
  assert.equal(v.status, 'WAITING');
  assert.ok(v.players.every((p) => p.totalScore === 0));
});

test('room:create: ส่ง moneyRate → view.moneyRate ตรง', () => {
  const io = makeFakeIo();
  createGameServer(io);
  const s1 = io._connect('sid1');
  call(s1, 'room:create', { name: 'A', moneyRate: 10 });
  assert.equal(lastUpdate(io, 'sid1').moneyRate, 10);
});

test('disconnect ตอน PLAYING + rejoin ด้วย token → กลับที่นั่งเดิม connected=true', () => {
  const io = makeFakeIo();
  const server = createGameServer(io);
  const s1 = io._connect('sid1');
  const r = call(s1, 'room:create', { name: 'A' });
  const code = r.code;
  const s2 = io._connect('sid2');
  const j = call(s2, 'room:join', { code, name: 'B' });
  const s3 = io._connect('sid3'); call(s3, 'room:join', { code, name: 'C' });
  const s4 = io._connect('sid4'); call(s4, 'room:join', { code, name: 'D' });
  call(s1, 'room:start', {});
  s2.fire('disconnect');
  assert.equal(lastUpdate(io, 'sid1').players.find((p) => p.id === 'p2').connected, false);
  // p2 ต่อใหม่ด้วย socket ใหม่ + token เดิม
  const s2b = io._connect('sid2b');
  const re = call(s2b, 'room:rejoin', { code, token: j.token });
  assert.equal(re.ok, true);
  assert.equal(re.playerId, 'p2');
  assert.equal(lastUpdate(io, 'sid1').players.find((p) => p.id === 'p2').connected, true);
  assert.ok(lastUpdate(io, 'sid2b').round.yourHand.length >= 7); // เห็นมือเดิม
});

test('grace หมดเวลา → host ได้ peer:graceExpired', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const io = makeFakeIo();
  createGameServer(io);
  const s1 = io._connect('sid1');
  const r = call(s1, 'room:create', { name: 'A' });
  const code = r.code;
  const s2 = io._connect('sid2'); call(s2, 'room:join', { code, name: 'B' });
  const s3 = io._connect('sid3'); call(s3, 'room:join', { code, name: 'C' });
  const s4 = io._connect('sid4'); call(s4, 'room:join', { code, name: 'D' });
  call(s1, 'room:start', {});
  s3.fire('disconnect');
  // ยังไม่ถึงเวลา
  assert.equal(emitsTo(io, 'sid1', 'peer:graceExpired').length, 0);
  t.mock.timers.tick(60_000); // graceSeconds=60
  const ge = emitsTo(io, 'sid1', 'peer:graceExpired');
  assert.equal(ge.length, 1);
  assert.equal(ge[0].data.playerId, 'p3');
});
