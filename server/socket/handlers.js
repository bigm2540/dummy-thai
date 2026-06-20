// socket/handlers.js — เชื่อม Socket.IO เข้ากับ roomManager (รับ event → เรียก logic → ส่ง view กลับ)
// แยกชัด: logic ห้อง/เกมอยู่ใน roomManager (เทสได้) — ที่นี่แค่ wiring + จับเวลา grace + broadcast
// ออกแบบให้ inject io ได้ → เทสด้วย fake io โดยไม่ต้องเปิดเน็ตจริง

import * as rm from '../room/roomManager.js';

export function createGameServer(io) {
  const rooms = new Map();        // code -> room
  const conns = new Map();        // code -> Map(playerId -> socketId)
  const graceTimers = new Map();  // `${code}:${pid}` -> Timeout

  const keyOf = (code, pid) => `${code}:${pid}`;

  function bindSocket(socket, code, playerId) {
    socket.data.code = code;
    socket.data.playerId = playerId;
    if (!conns.has(code)) conns.set(code, new Map());
    conns.get(code).set(playerId, socket.id);
  }

  // ส่ง view เฉพาะตัวให้แต่ละผู้เล่นในห้อง (กันโกง — ไพ่ลับไม่ปนกัน)
  function broadcast(code) {
    const room = rooms.get(code);
    const map = conns.get(code);
    if (!room || !map) return;
    for (const [pid, sid] of map) {
      io.to(sid).emit('room:update', rm.getRoomView(room, pid));
    }
  }

  function clearGrace(code, pid) {
    const k = keyOf(code, pid);
    if (graceTimers.has(k)) { clearTimeout(graceTimers.get(k)); graceTimers.delete(k); }
  }

  io.on('connection', (socket) => {
    if (!socket.data) socket.data = {};
    const reply = (cb, ok, extra = {}) => { if (typeof cb === 'function') cb({ ok, ...extra }); };
    const room = () => rooms.get(socket.data.code);
    const requireHost = (r) => {
      if (!r) throw new Error('ไม่พบห้อง');
      if (r.hostId !== socket.data.playerId) throw new Error('เฉพาะ host ทำได้');
    };

    socket.on('room:create', ({ name, config } = {}, cb) => {
      try {
        const r = rm.createRoom({ hostName: name, config });
        rooms.set(r.code, r);
        const host = r.players[0];
        bindSocket(socket, r.code, host.id);
        reply(cb, true, { code: r.code, token: host.token, playerId: host.id });
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('room:join', ({ code, name } = {}, cb) => {
      try {
        const r = rooms.get(code);
        if (!r) throw new Error('ไม่พบห้อง');
        const p = rm.joinRoom(r, { name });
        bindSocket(socket, code, p.id);
        reply(cb, true, { code, token: p.token, playerId: p.id });
        broadcast(code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    // กลับเข้าเกมด้วย token (auto จาก client หลัง reconnect)
    socket.on('room:rejoin', ({ code, token } = {}, cb) => {
      try {
        const r = rooms.get(code);
        if (!r) throw new Error('ไม่พบห้อง');
        const p = rm.rejoinByToken(r, token);
        clearGrace(code, p.id);
        bindSocket(socket, code, p.id);
        reply(cb, true, { code, token: p.token, playerId: p.id });
        broadcast(code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('room:start', (_payload, cb) => {
      try {
        const r = room(); requireHost(r);
        rm.startGame(r);
        reply(cb, true);
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('game:action', ({ type, payload } = {}, cb) => {
      try {
        const r = room();
        if (!r) throw new Error('ไม่พบห้อง');
        rm.applyAction(r, socket.data.playerId, type, payload ?? {});
        reply(cb, true);
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('round:next', (_payload, cb) => {
      try {
        const r = room(); requireHost(r);
        rm.startNextRound(r);
        reply(cb, true);
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('room:close', (_payload, cb) => {
      try {
        const r = room(); requireHost(r);
        rm.closeRoom(r);
        reply(cb, true);
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    // host ตัดสินใจเมื่อมีคนหลุดเกิน grace: 'wait' (รอต่อ) / 'end' (จบแมตช์)
    socket.on('peer:resolve', ({ decision } = {}, cb) => {
      try {
        const r = room(); requireHost(r);
        if (decision === 'end') rm.closeRoom(r);
        reply(cb, true);
        broadcast(r.code);
      } catch (e) { reply(cb, false, { error: e.message }); }
    });

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      const map = conns.get(code);
      if (map && map.get(playerId) === socket.id) map.delete(playerId); // ลบเฉพาะถ้ายังเป็น socket ปัจจุบัน
      const r = rooms.get(code);
      if (!r) return;
      if (r.status === 'WAITING') {
        try { rm.leaveRoom(r, playerId); } catch { /* อาจถูกลบไปแล้ว */ }
        broadcast(code);
        return;
      }
      // กำลังเล่น → mark หลุด + จับเวลา grace แล้วเด้ง popup ให้ host
      rm.markDisconnected(r, playerId);
      broadcast(code);
      clearGrace(code, playerId);
      const k = keyOf(code, playerId);
      graceTimers.set(k, setTimeout(() => {
        graceTimers.delete(k);
        const hostSid = conns.get(code)?.get(r.hostId);
        if (hostSid) io.to(hostSid).emit('peer:graceExpired', { playerId });
      }, r.settings.graceSeconds * 1000));
    });
  });

  return { rooms, conns, graceTimers, broadcast };
}
