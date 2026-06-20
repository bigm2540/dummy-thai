// เทส M5 ขั้น 1: roomManager (logic ห้องล้วน — ไม่มี socket)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, leaveRoom, startGame, startNextRound, applyAction,
  markDisconnected, rejoinByToken, isGraceExpired, closeRoom, getRoomView,
  playerById, MAX_PLAYERS,
} from '../server/room/roomManager.js';
import { isZeroSum } from '../server/game/scoring.js';

// ตัวสร้างรหัส/โทเคนแบบกำหนดได้ (เทส)
let codeN = 0; let tokN = 0;
const genCode = () => `ROOM${codeN++}`;
const genToken = () => `tok${tokN++}`;
function makeFullRoom() {
  codeN = 0; tokN = 0;
  const room = createRoom({ hostName: 'A', genCode, genToken });
  joinRoom(room, { name: 'B' });
  joinRoom(room, { name: 'C' });
  joinRoom(room, { name: 'D' });
  return room;
}

test('createRoom: host เป็นคนแรก + status WAITING + มีรหัส/โทเคน', () => {
  codeN = 0; tokN = 0;
  const room = createRoom({ hostName: 'A', genCode, genToken });
  assert.equal(room.status, 'WAITING');
  assert.equal(room.code, 'ROOM0');
  assert.equal(room.players.length, 1);
  assert.equal(room.hostId, 'p1');
  assert.equal(room.players[0].name, 'A');
  assert.ok(room.players[0].token);
});

test('joinRoom: เพิ่มได้ถึง 4 คน, คนที่ 5 → error', () => {
  const room = makeFullRoom();
  assert.equal(room.players.length, MAX_PLAYERS);
  assert.deepEqual(room.players.map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.throws(() => joinRoom(room, { name: 'E' }), /เต็ม/);
});

test('joinRoom: เริ่มเกมแล้วเข้าไม่ได้', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  assert.throws(() => joinRoom(room, { name: 'E' }), /เริ่มแล้ว/);
});

test('leaveRoom (WAITING): ลบ + เรียง seat/id ใหม่ + ย้าย host ถ้าจำเป็น', () => {
  codeN = 0; tokN = 0;
  const room = createRoom({ hostName: 'A', genCode, genToken });
  joinRoom(room, { name: 'B' });
  joinRoom(room, { name: 'C' });
  leaveRoom(room, 'p1'); // host ออก
  assert.equal(room.players.length, 2);
  assert.deepEqual(room.players.map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(room.players.map((p) => p.name), ['B', 'C']);
  assert.equal(room.hostId, 'p1'); // ย้าย host ไปคนแรกที่เหลือ (B)
});

test('startGame: ต้องครบ 4 คน + เริ่มรอบ (round พร้อมเล่น)', () => {
  codeN = 0; tokN = 0;
  const room = createRoom({ hostName: 'A', genCode, genToken });
  assert.throws(() => startGame(room), /ครบ 4 คน/);
  joinRoom(room, { name: 'B' }); joinRoom(room, { name: 'C' }); joinRoom(room, { name: 'D' });
  startGame(room, { rng: () => 0 });
  assert.equal(room.status, 'PLAYING');
  assert.ok(room.round);
  assert.equal(room.round.playerIds.length, 4);
  assert.equal(room.round.dealerSeat, 0);
  assert.equal(room.round.direction, 1);
});

test('applyAction: ส่งต่อไป engine (จั่ว→ทิ้ง เลื่อนตา)', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  applyAction(room, 'p1', 'DRAW_STOCK');
  assert.equal(room.round.phase, 'ACTION');
  const toDiscard = room.round.hands.p1[0].id;
  applyAction(room, 'p1', 'DISCARD', { cardId: toDiscard });
  assert.equal(room.round.currentSeat, 1); // ตา p2
});

test('applyAction: ผิดตา → โยน error จาก engine', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  assert.throws(() => applyAction(room, 'p2', 'DRAW_STOCK'), /ตาคุณ/);
});

test('จบรอบ → สะสม totalScore + lastSummary + awaitingNextRound (zero-sum)', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  // จัดฉากน็อค: p1 เกิด 2 ชุดเหลือใบปิด 1
  const r = room.round;
  r.phase = 'ACTION'; r.currentSeat = 0; r.turnNo = 3; r.headId = 'X0';
  r.melds = [
    { id: 'm1', type: 'RUN', ownerId: 'p1', cards: ['S4','S5','S6'].map((id) => ({ card: { id, suit: id[0], rank: id.slice(1) }, placedBy: 'p1' })) },
    { id: 'm2', type: 'SET', ownerId: 'p1', cards: ['H7','D7','C7'].map((id) => ({ card: { id, suit: id[0], rank: id.slice(1) }, placedBy: 'p1' })) },
  ];
  r.hands.p1 = [{ id: 'SK', suit: 'S', rank: 'K' }];
  r.playerStates.p1 = { hasMelded: true, firstMeldTurn: 1, hasPlayed: true, shownSpeto: false };
  ['p2', 'p3', 'p4'].forEach((id) => {
    r.hands[id] = [{ id: 'H3', suit: 'H', rank: '3' }];
    r.playerStates[id] = { hasMelded: true, firstMeldTurn: 1, hasPlayed: true, shownSpeto: false };
  });
  applyAction(room, 'p1', 'KNOCK', { faceDownCardId: 'SK' });
  assert.equal(room.round.status, 'ENDED');
  assert.ok(room.awaitingNextRound);
  assert.ok(room.lastSummary);
  // คะแนนสะสม = คะแนนรอบ (รอบแรก) + zero-sum
  const sum = room.players.reduce((a, p) => a + p.totalScore, 0);
  assert.equal(sum, 0);
  assert.ok(room.players[0].totalScore > 0); // p1 น็อคได้บวก
  const row = room.lastSummary.rows.find((x) => x.playerId === 'p1');
  assert.ok(row.breakdown.some((b) => b.type === 'KNOCK'));
});

test('startNextRound: หมุนเจ้ามือ (+ ส่งทิศต่อ) + สะสมคะแนนข้ามรอบ', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  // จบรอบแรกแบบกองหมด (เร็วๆ)
  const r = room.round;
  r.phase = 'DRAW'; r.currentSeat = 0; r.stock = []; r.lastTurn = true;
  ['p1', 'p2', 'p3', 'p4'].forEach((id) => {
    r.hands[id] = [{ id: 'S5', suit: 'S', rank: '5' }];
    r.playerStates[id] = { hasMelded: true, firstMeldTurn: 1, hasPlayed: true, shownSpeto: false };
  });
  applyAction(room, 'p1', 'PASS');
  assert.ok(room.awaitingNextRound);
  assert.equal(room.dealerSeat, 1); // หมุนจาก 0 → 1
  startNextRound(room, { rng: () => 0 });
  assert.equal(room.round.dealerSeat, 1);
  assert.equal(room.round.currentSeat, 1);
  assert.ok(!room.awaitingNextRound);
});

test('reconnect: หลุด → connected=false, rejoin ด้วย token กลับที่นั่งเดิม', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  const tokenP2 = room.players[1].token;
  markDisconnected(room, 'p2', 1000);
  assert.equal(playerById(room, 'p2').connected, false);
  assert.equal(isGraceExpired(room, 'p2', 1000 + 59_000), false); // ยังไม่เกิน 60 วิ
  assert.equal(isGraceExpired(room, 'p2', 1000 + 61_000), true);  // เกินแล้ว
  const p = rejoinByToken(room, tokenP2);
  assert.equal(p.id, 'p2');
  assert.equal(p.connected, true);
  assert.equal(p.disconnectedAt, null);
  assert.throws(() => rejoinByToken(room, 'ไม่มีจริง'), /โทเคน/);
});

test('getRoomView: ซ่อนมือคนอื่น + ไม่หลุด token', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  const view = getRoomView(room, 'p1');
  assert.equal(view.you, 'p1');
  assert.equal(view.players.length, 4);
  assert.ok(!JSON.stringify(view).includes('tok')); // ไม่มี token รั่ว
  assert.ok(view.round.yourHand.length >= 7);        // เห็นมือตัวเอง
  assert.equal(view.round.hands, undefined);          // ไม่เห็น hands ดิบ
});

test('closeRoom: FINISHED + สรุปเงินรวม (= total × rate)', () => {
  const room = makeFullRoom();
  startGame(room, { rng: () => 0 });
  room.players[0].totalScore = 10;
  room.players[1].totalScore = -10;
  closeRoom(room);
  assert.equal(room.status, 'FINISHED');
  const f = getRoomView(room, 'p1').finalSummary;
  assert.equal(f.find((x) => x.playerId === 'p1').money, 10 * room.config.moneyRate);
});
