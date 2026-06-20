// เทส M4a: เครื่องยนต์รอบ (สถานะ/จั่ว/เกิด/ฝาก/ทิ้ง/น็อค/PlayerView)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startRound, drawStock, pickDiscard, meld, layoff, discard, knock, allowedActions, totals, showSpeto,
  passTurn, nextDealerSeat,
} from '../server/game/round.js';
import { getPlayerView } from '../server/game/playerView.js';
import { isZeroSum } from '../server/game/scoring.js';

const c = (id) => ({ id, suit: id[0], rank: id.slice(1) });
const cs = (...a) => a.map(c);
const P = ['A', 'B', 'C', 'D'];

test('startRound: สถานะเริ่มต้นถูกต้อง', () => {
  const s = startRound({ playerIds: P, dealerSeat: 0 });
  assert.equal(s.phase, 'DRAW');
  assert.equal(s.currentSeat, 0);
  assert.equal(s.stock.length, 23);
  P.forEach((id) => assert.equal(s.hands[id].length, 7));
  assert.equal(s.discard.length, 1);          // ไพ่หัว
  assert.equal(s.discard[0].id, s.headId);
});

test('drawStock: จั่วแล้วมือ +1, ไป ACTION; ผิดตา/ผิดช่วง → error', () => {
  const s = startRound({ playerIds: P });
  assert.throws(() => drawStock(s, 'B'), /ตาคุณ/);    // ยังไม่ใช่ตา B
  drawStock(s, 'A');
  assert.equal(s.hands.A.length, 8);
  assert.equal(s.phase, 'ACTION');
  assert.throws(() => drawStock(s, 'A'), /DRAW/);     // จั่วซ้ำไม่ได้
});

test('meld: เกิดชุดถูก → ลงโต๊ะ + hasMelded; ชุดผิด → error', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  s.hands.A = cs('S7', 'H7', 'D7', 'C2', 'H2', 'D2', 'SK', 'S9');
  meld(s, 'A', ['S7', 'H7', 'D7']);
  assert.equal(s.melds.length, 1);
  assert.ok(s.playerStates.A.hasMelded);
  assert.equal(s.hands.A.length, 5);
  assert.throws(() => meld(s, 'A', ['SK', 'S9']), /ไม่ถูกกติกา/);
});

test('meld สเปโต → ได้โบนัส SPETO_MELD (+3/−1)', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  s.hands.A = cs('C2', 'H2', 'D2', 'SK');     // C2 = สเปโต
  meld(s, 'A', ['C2', 'H2', 'D2']);
  const ev = s.events.find((e) => e.type === 'SPETO_MELD');
  assert.ok(ev);
  assert.equal(totals(s).A, 3);               // +3 จากคนอื่น 3 คน
  assert.ok(isZeroSum(totals(s)));
});

test('layoff: ต้องเกิดก่อน; แล้วฝากเข้าชุดได้', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  s.hands.A = cs('S7', 'H7', 'D7', 'C7', 'SK');
  assert.throws(() => layoff(s, 'A', 'C7', 'meld1'), /เกิดของตัวเองก่อน/);
  meld(s, 'A', ['S7', 'H7', 'D7']);
  layoff(s, 'A', 'C7', 'meld1');              // ฝากใบที่ 4 เข้าตอง
  assert.equal(s.melds[0].cards.length, 4);
  assert.equal(s.hands.A.length, 1);
});

test('discard: ทิ้งแล้วไปกองทิ้ง + เลื่อนตา', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  const before = s.discard.length;
  discard(s, 'A', s.hands.A[0].id);
  assert.equal(s.discard.length, before + 1);
  assert.equal(s.currentSeat, 1);             // ตา B
  assert.equal(s.phase, 'DRAW');
});

test('ทิ้งดัมมี่: ทิ้งใบที่ฝากเข้าชุดบนโต๊ะได้ → คนทิ้ง −3 / คนอื่น +1', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0;
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'B',
    cards: cs('S7', 'H7', 'D7').map((x) => ({ card: x, placedBy: 'B' })) }];
  s.hands.A = cs('C7', 'S9');                  // C7 ฝากเข้าตอง 7 ได้
  discard(s, 'A', 'C7');
  const ev = s.events.find((e) => e.type === 'TING_DUMMY');
  assert.ok(ev, 'ต้องมี event TING_DUMMY');
  const t = totals(s);
  assert.equal(t.A, -3); assert.equal(t.B, 1); assert.equal(t.C, 1); assert.equal(t.D, 1);
  assert.ok(isZeroSum(t));
});

test('ทิ้งเต็ม: ทิ้งใบที่รวมกับกองทิ้งบนสุดเป็นชุดสมบูรณ์ → −3 / +1', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0;
  s.discard = cs('H9', 'S7', 'H7');            // ก้นกอง H9, บนสุด S7,H7
  s.hands.A = cs('D7', 'S2');                  // ทิ้ง D7 → บนสุด 3 ใบ S7,H7,D7 = ตอง
  discard(s, 'A', 'D7');
  assert.ok(s.events.find((e) => e.type === 'TING_FULL'), 'ต้องมี TING_FULL');
  const t = totals(s);
  assert.equal(t.A, -3); assert.ok(isZeroSum(t));
});

test('ทิ้งปกติ: ไม่เข้าชุดบนโต๊ะ/กองทิ้ง → ไม่มีโทษ', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0;
  s.discard = cs('H9', 'S7', 'H2');            // บนสุดไม่เป็นชุด
  s.hands.A = cs('DK', 'S2');
  discard(s, 'A', 'DK');
  assert.equal(s.events.length, 0);
});

test('ทิ้งดัมมี่ + ทิ้งเต็ม ซ้อนกัน → −6 / +2', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0;
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'B',
    cards: cs('S7', 'H7', 'D7').map((x) => ({ card: x, placedBy: 'B' })) }];
  s.discard = cs('H9', 'C5', 'C6');            // C5,C6,C7 = เรียงดอกจิก (ทิ้งเต็ม)
  s.hands.A = cs('C7', 'S2');                  // C7 ฝากตอง 7 ได้ (ทิ้งดัมมี่) + ปิดเรียง
  discard(s, 'A', 'C7');
  assert.ok(s.events.find((e) => e.type === 'TING_DUMMY'));
  assert.ok(s.events.find((e) => e.type === 'TING_FULL'));
  const t = totals(s);
  assert.equal(t.A, -6); assert.equal(t.B, 2);
  assert.ok(isZeroSum(t));
});

test('ฝากสเปโตเข้าชุดตัวเอง: +3 / คนอื่นทุกคน −1', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3;
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'A',
    cards: cs('C3', 'C4', 'C5').map((x) => ({ card: x, placedBy: 'A' })) }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('C2', 'SK');                    // C2 = สเปโต ต่อ C3 (เรียงดอกจิก)
  layoff(s, 'A', 'C2', 'm1');
  const ev = s.events.find((e) => e.type === 'SPETO_LAYOFF_SELF');
  assert.ok(ev);
  const t = totals(s);
  assert.equal(t.A, 3); assert.equal(t.B, -1); assert.equal(t.C, -1); assert.equal(t.D, -1);
  assert.ok(isZeroSum(t));
});

test('ฝากสเปโตเข้าชุดคนอื่น: +3 คนฝาก / −3 ผู้เสีย (placedBy ของใบที่ไปต่อ)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3;
  // ชุดเจ้าของ B แต่ SJ เป็นไพ่ที่ C ฝากมาก่อน → A เอา SQ(สเปโต)ต่อปลาย SJ → C เสีย (ไม่ใช่ B)
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'B', cards: [
    { card: c('S9'), placedBy: 'B' },
    { card: c('S10'), placedBy: 'B' },
    { card: c('SJ'), placedBy: 'C' },   // C ฝาก SJ มาก่อน → SQ ต่อ SJ → C เสีย
  ] }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('SQ', 'D2');
  layoff(s, 'A', 'SQ', 'm1');
  const ev = s.events.find((e) => e.type === 'SPETO_LAYOFF_OTHER');
  assert.ok(ev);
  const t = totals(s);
  assert.equal(t.A, 3); assert.equal(t.C, -3);   // ผู้เสีย = เจ้าของใบที่ไปต่อ (SJ = C)
  assert.equal(t.B ?? 0, 0); assert.equal(t.D ?? 0, 0);
  assert.ok(isZeroSum(t));
});

test('ฝากสเปโตเข้าตองคนอื่น (ไม่มีใบก่อนหน้า) → เจ้าของชุดเสีย', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3;
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'C',
    cards: cs('HQ', 'DQ', 'CQ').map((x) => ({ card: x, placedBy: 'C' })) }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('SQ', 'D2');                     // SQ = ควีนโพดำ (สเปโต) เข้าตองควีน
  layoff(s, 'A', 'SQ', 'm1');
  const t = totals(s);
  assert.equal(t.A, 3); assert.equal(t.C, -3);    // ตอง ไม่มีใบก่อนหน้า → เจ้าของ(C)เสีย
  assert.ok(isZeroSum(t));
});

test('โชว์สเปโต: มีครบ 2 ใบตอนแจก → +6 / คนอื่น −2 (ทำได้เฉพาะต้นรอบ)', () => {
  const s = startRound({ playerIds: P });
  s.hands.A = cs('C2', 'SQ', 'S5', 'S6', 'S7', 'S8', 'S9'); // ครบสเปโต 2 ใบ
  assert.ok(allowedActions(s, 'A').includes('SHOW_SPETO'));
  showSpeto(s, 'A');
  const t = totals(s);
  assert.equal(t.A, 6); assert.equal(t.B, -2); assert.equal(t.C, -2); assert.equal(t.D, -2);
  assert.ok(isZeroSum(t));
  assert.throws(() => showSpeto(s, 'A'), /โชว์สเปโตไปแล้ว/);   // ซ้ำไม่ได้
  // ไม่ครบ 2 ใบ → ไม่ได้
  s.hands.B = cs('C2', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10');
  assert.throws(() => showSpeto(s, 'B'), /ครบ 2 ใบ/);
});

test('โชว์สเปโต: เล่นตาตัวเองแล้ว → โชว์ไม่ได้ (แต่คนยังไม่เล่นโชว์ได้ข้ามตา)', () => {
  const s = startRound({ playerIds: P });
  s.hands.A = cs('C2', 'SQ', 'S5', 'S6', 'S7', 'S8', 'S9');
  s.hands.B = cs('C2', 'SQ', 'H5', 'H6', 'H7', 'H8', 'H9'); // (สมมุติ — เทสเฉพาะ gate)
  drawStock(s, 'A');                              // A เล่นตาตัวเองแล้ว
  assert.throws(() => showSpeto(s, 'A'), /ก่อนเล่นตาแรก/);
  // B ยังไม่เล่น → ยังโชว์ได้ แม้จะเลย turn 1 / ไม่ใช่ตา B
  assert.ok(allowedActions(s, 'B').includes('SHOW_SPETO'));
  showSpeto(s, 'B');
  assert.ok(s.events.some((e) => e.type === 'SHOW_SPETO' && e.by === 'B'));
  assert.ok(isZeroSum(totals(s)));
});

test('โชว์สเปโต: คนที่เล่นตาตัวเองแล้ว ไม่มี SHOW_SPETO ใน allowedActions', () => {
  const s = startRound({ playerIds: P });
  s.hands.A = cs('C2', 'SQ', 'S5', 'S6', 'S7', 'S8', 'S9');
  assert.ok(allowedActions(s, 'A').includes('SHOW_SPETO'));
  drawStock(s, 'A');
  assert.ok(!allowedActions(s, 'A').includes('SHOW_SPETO'));
});

test('layoff สเปโต ไม่ยิง SPETO_MELD (ต้องเป็นฝากสเปโต ไม่ใช่เกิดสเปโต)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3;
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'A',
    cards: cs('C3', 'C4', 'C5').map((x) => ({ card: x, placedBy: 'A' })) }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('C2', 'SK');
  layoff(s, 'A', 'C2', 'm1');
  assert.ok(!s.events.some((e) => e.type === 'SPETO_MELD'));  // ไม่ใช่เกิดสเปโต
  assert.ok(s.events.some((e) => e.type === 'SPETO_LAYOFF_SELF'));
});

test('allowedActions: ตามช่วง + เฉพาะตาตัวเอง', () => {
  const s = startRound({ playerIds: P });
  assert.deepEqual(allowedActions(s, 'A'), ['DRAW_STOCK', 'PICK_DISCARD']);
  assert.deepEqual(allowedActions(s, 'B'), []); // ไม่ใช่ตา B
  drawStock(s, 'A');
  assert.deepEqual(allowedActions(s, 'A'), ['MELD', 'LAYOFF', 'DISCARD']);
  s.hands.A = cs('SK'); // เหลือ 1 ใบ → น็อคได้
  assert.ok(allowedActions(s, 'A').includes('KNOCK'));
});

test('PlayerView: เห็นไพ่ตัวเอง แต่มือคนอื่นเห็นแค่จำนวน (กันโกง)', () => {
  const s = startRound({ playerIds: P });
  const v = getPlayerView(s, 'A');
  assert.equal(v.yourHand.length, 7);                 // เห็นไพ่ตัวเอง
  assert.equal(typeof v.handCounts.B, 'number');      // คนอื่นเห็นแค่จำนวน
  assert.equal(v.handCounts.B, 7);
  assert.equal(typeof v.stockCount, 'number');        // กองจั่วเห็นแค่จำนวน
  assert.ok(!('hands' in v));                         // ไม่หลุดมือทุกคน
  assert.ok(Array.isArray(v.discard));                // กองทิ้งสาธารณะ
});

test('เก็บกอง (เกิด): ขุดใบบนสุดมาเกิดตอง + ใบที่ติดมาเข้ามือ', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'DRAW'; s.currentSeat = 0; s.headId = 'X0';
  s.discard = cs('D3', 'H5', 'S9');          // S9 = ใบบนสุด (index 2)
  s.hands.A = cs('H9', 'D9', 'SK', 'SQ', 'SJ', 'S10', 'S8');
  pickDiscard(s, 'A', 2, { meldCardIds: ['H9', 'D9'] }); // เอา S9 + H9,D9 = ตอง 9
  assert.equal(s.melds.length, 1);
  assert.equal(s.melds[0].cards.length, 3);
  assert.ok(!s.hands.A.find((c) => c.id === 'H9'));   // ออกจากมือ
  assert.deepEqual(s.discard.map((c) => c.id), ['D3', 'H5']); // เหลือในกอง
  assert.equal(s.phase, 'ACTION');
});

test('เก็บกอง (เกิดหัว): ขุดถึงก้นกอง = ได้ทั้งกอง + HEAD_MELD + headMelded', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'DRAW'; s.currentSeat = 0; s.headId = 'D3';
  s.discard = cs('D3', 'H5', 'S9');          // D3 = ไพ่หัว (ก้นกอง index 0)
  s.hands.A = cs('D4', 'D5', 'SK', 'SQ', 'SJ', 'S10', 'S8');
  pickDiscard(s, 'A', 0, { meldCardIds: ['D4', 'D5'] }); // เกิดเรียง D3-D4-D5
  assert.ok(s.headMelded);
  assert.ok(s.events.some((e) => e.type === 'HEAD_MELD'));
  assert.ok(s.hands.A.find((c) => c.id === 'H5')); // ใบเหนือหัวเข้ามือ
  assert.ok(s.hands.A.find((c) => c.id === 'S9'));
  assert.equal(s.discard.length, 0);              // ขุดทั้งกอง
  assert.ok(isZeroSum(totals(s)));
});

test('เก็บกอง: ไพ่หัวเป็นสเปโต (SQ) → ได้ทั้ง HEAD_MELD + SPETO_MELD', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'DRAW'; s.currentSeat = 0; s.headId = 'SQ';
  s.discard = cs('SQ', 'H5');                 // SQ = หัว + สเปโต
  s.hands.A = cs('SK', 'SA', 'D2', 'D3', 'D4', 'D5', 'D6'); // SQ-SK-SA เรียง
  pickDiscard(s, 'A', 0, { meldCardIds: ['SK', 'SA'] });
  assert.ok(s.events.some((e) => e.type === 'HEAD_MELD'));
  assert.ok(s.events.some((e) => e.type === 'SPETO_MELD'));
  assert.ok(isZeroSum(totals(s)));
});

test('เก็บกอง: เกิดจนมือเหลือ 0 → ปฏิเสธ (ต้องเหลือใบปิด)', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'DRAW'; s.currentSeat = 0; s.headId = 'X0';
  s.discard = cs('S9');
  s.hands.A = cs('H9', 'D9');                 // 2 ใบ ประกอบกับ S9 เป็นตอง → มือ 0
  assert.throws(() => pickDiscard(s, 'A', 0, { meldCardIds: ['H9', 'D9'] }), /ใบปิด/);
});

test('เก็บกอง (ฝาก): ต้องเกิดก่อน + ฝาก target เข้าชุดได้', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'DRAW'; s.currentSeat = 0; s.headId = 'X0';
  s.discard = cs('C7');                       // ใบบนสุด = C7
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'A', cards: cs('S7', 'H7', 'D7').map((x) => ({ card: x, placedBy: 'A' })) }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('SK', 'SQ');
  pickDiscard(s, 'A', 0, { layoffMeldId: 'm1' }); // ฝาก C7 เข้าตอง 7
  assert.equal(s.melds[0].cards.length, 4);
  assert.equal(s.phase, 'ACTION');
});

test('ต้องเหลือใบปิด ≥1: เกิด/ฝาก จนมือเหลือ 0 → ปฏิเสธ', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  // เกิดจนมือเหลือ 0 → ห้าม
  s.hands.A = cs('S7', 'H7', 'D7');
  assert.throws(() => meld(s, 'A', ['S7', 'H7', 'D7']), /ใบปิด/);
  // ฝากใบสุดท้าย → ห้าม
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'A', cards: cs('S7', 'H7', 'D7').map((x) => ({ card: x, placedBy: 'A' })) }];
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.A = cs('C7'); // เหลือ 1 ใบ จะฝากให้เหลือ 0
  assert.throws(() => layoff(s, 'A', 'C7', 'm1'), /ใบปิด/);
});

test('ทิ้งใบสุดท้ายไม่ได้ (เหลือ 1 ใบต้องน็อค)', () => {
  const s = startRound({ playerIds: P });
  drawStock(s, 'A');
  s.hands.A = cs('SK'); // เหลือ 1 ใบ
  assert.throws(() => discard(s, 'A', 'SK'), /น็อค/);
});

test('ปี้สเปโต: B ทิ้งสเปโต → C เก็บไปเกิด → B โดนปี้ −1/คน (1 ตา)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0';
  // B ทิ้ง C2 (สเปโต) ตา 1
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 1;
  s.hands.B = cs('C2', 'S5');
  discard(s, 'B', 'C2');                       // → กองทิ้งบนสุด, ไป C ตา 2
  assert.equal(s.currentSeat, 2); assert.equal(s.turnNo, 2);
  // C เก็บ C2 ไปเกิดตอง 2
  s.hands.C = cs('H2', 'D2', 'SK', 'S9');
  pickDiscard(s, 'C', s.discard.length - 1, { meldCardIds: ['H2', 'D2'] });
  const ev = s.events.find((e) => e.type === 'PEE');
  assert.ok(ev, 'ต้องมี event PEE'); assert.equal(ev.by, 'B');
  const t = totals(s);
  // ปี้สเปโต −1/คน: B −3, อีก 3 คน +1 ... แต่มี SPETO_MELD ของ C ด้วย (+3/−1)
  assert.equal(t.B, -3 - 1);                   // ปี้ −3 + โดนเกิดสเปโต −1
  assert.ok(isZeroSum(t));
});

test('ปี้หัว+สเปโต: เกิด 2♣-3♣-4♣ (3♣=หัว,2♣=สเปโต) ใช้ 4♣ ที่เพิ่งทิ้ง → ปี้ −2/คน', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'C3';                             // หัว = 3♣
  s.discard = cs('C3');                         // ก้นกอง = หัว (ยังไม่มีใครทิ้ง)
  // B ทิ้ง 4♣ ตา 1
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 1;
  s.hands.B = cs('C4', 'S5');
  discard(s, 'B', 'C4');                        // กอง: [C3(หัว), C4] ; ไป C ตา 2
  // C ขุดถึงก้นกอง: target=C3(หัว), ขุดติด C4 มา, มี C2 ในมือ → เกิด C2-C3-C4
  s.hands.C = cs('C2', 'SK', 'S9', 'S10');
  pickDiscard(s, 'C', 0, { meldCardIds: ['C4', 'C2'] }); // C4 จาก picked, C2 จากมือ
  const pee = s.events.find((e) => e.type === 'PEE');
  assert.ok(pee && pee.by === 'B', 'B โดนปี้');
  assert.match(pee.note, /หัว\+สเปโต/);
  // ปี้ทั้งคู่ = −2/คน → B จ่าย 3 คน = −6 (เฉพาะส่วนปี้)
  const peeTotal = pee.deltas.find((d) => d.id === 'B').amount;
  assert.equal(peeTotal, -6);
  assert.ok(s.events.some((e) => e.type === 'HEAD_MELD'));
  assert.ok(s.events.some((e) => e.type === 'SPETO_MELD'));
  assert.ok(isZeroSum(totals(s)));
});

test('ปี้หมดอายุ: เก็บไพ่ที่ทิ้งเกิน 1 ตา → ไม่ปี้', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0';
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 1;
  s.hands.B = cs('C2', 'S5'); discard(s, 'B', 'C2');   // B ทิ้ง C2 ตา 1
  // C ทิ้งอย่างอื่นตา 2 (C2 จมลงไป)
  s.hands.C = cs('H8', 'S5'); drawStock(s, 'C'); discard(s, 'C', s.hands.C.find((c)=>c.id==='H8')?'H8':s.hands.C[0].id);
  // D เก็บ C2 ตา 3 (เกิน 1 ตาจากตอนทิ้ง) → ไม่ปี้
  const idx = s.discard.findIndex((c) => c.id === 'C2');
  s.hands.D = cs('H2', 'D2', 'SK', 'S9');
  pickDiscard(s, 'D', idx, { meldCardIds: ['H2', 'D2'] });
  assert.ok(!s.events.some((e) => e.type === 'PEE'), 'เกิน 1 ตา ไม่ปี้');
});

test('โง่: B ทิ้ง → C เก็บไปน็อค (ปกติ) → B จ่ายแทนทั้งวง −6, A/D = 0, วนทิศ', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0';
  // B ทิ้ง S9 ตา 4 (ไม่ใช่ต้นรอบ → ไม่ชนมืด)
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 4; s.direction = 1;
  s.hands.B = cs('S9', 'S5'); discard(s, 'B', 'S9'); // → C ตา 5
  assert.equal(s.currentSeat, 2);
  // C เก็บ S9 ไปเกิดตอง 9 แล้วเหลือใบปิด 1 → น็อค
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'C', cards: cs('H4','H5','H6').map((x)=>({card:x,placedBy:'C'})) }];
  s.playerStates.C = { hasMelded: true, firstMeldTurn: 2 };
  s.hands.C = cs('H9', 'D9', 'SK');             // เกิด 9 ใช้ S9 + H9,D9, เหลือ SK ปิด
  pickDiscard(s, 'C', s.discard.length - 1, { meldCardIds: ['H9', 'D9'] });
  assert.equal(s.hands.C.length, 1);
  s.hands.A = cs('S2'); s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.D = cs('S3'); s.playerStates.D = { hasMelded: true, firstMeldTurn: 1 };
  knock(s, 'C', 'SK', () => 0);
  const ev = s.events.find((e) => e.type === 'KNOCK_NGOH');
  assert.ok(ev, 'ต้องเป็นโง่ (KNOCK_NGOH)');
  assert.match(ev.note, /^โง่ /);
  const t = totals(s);
  assert.equal(t.C, 6); assert.equal(t.B, -6);
  assert.equal(t.A ?? 0, 0); assert.equal(t.D ?? 0, 0); // A/D ไม่เสีย
  assert.equal(s.direction, -1);               // วนทิศ
  assert.ok(isZeroSum(t));
});

test('โง่ + ใบปิดพิเศษ: โบนัสใบปิดคิดแยกซ้อน (คนอื่นทุกคนรวมคนโง่ −1, คนน็อค +3)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0';
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 4; s.direction = 1;
  s.hands.B = cs('S9', 'S5'); discard(s, 'B', 'S9'); // B ทิ้ง S9 → C
  s.playerStates.C = { hasMelded: true, firstMeldTurn: 2 }; // เกิดมาก่อน → ไม่มืด
  s.hands.C = cs('H9', 'D9', 'C2');                  // เกิด 9 ใช้ S9+H9,D9 เหลือ C2 (สเปโต=ใบปิดพิเศษ)
  pickDiscard(s, 'C', s.discard.length - 1, { meldCardIds: ['H9', 'D9'] });
  assert.equal(s.hands.C.length, 1);
  s.hands.A = cs('S2'); s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.D = cs('S3'); s.playerStates.D = { hasMelded: true, firstMeldTurn: 1 };
  knock(s, 'C', 'C2', () => 0);
  assert.ok(s.events.some((e) => e.type === 'KNOCK_NGOH'));
  assert.ok(s.events.some((e) => e.type === 'CLOSE_CARD')); // ใบปิดพิเศษคิดแยก
  const t = totals(s);
  // โง่: C+6/B−6 · ใบปิด: C+3, B/A/D −1 → C=9, B=−7, A=−1, D=−1
  assert.equal(t.C, 9); assert.equal(t.B, -7);
  assert.equal(t.A, -1); assert.equal(t.D, -1);
  assert.ok(isZeroSum(t));
});

test('โง่มืดจนชนมืด: น็อคมืดตั้งแต่ต้นรอบ → ×4 = −24', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0';
  s.phase = 'ACTION'; s.currentSeat = 1; s.turnNo = 2; // ต้นรอบ (≤4)
  s.hands.B = cs('S9', 'S5'); discard(s, 'B', 'S9');   // → C ตา 3
  // C เกิดครั้งแรกตานี้ (มืด) ด้วยการเก็บกอง แล้วน็อค
  s.hands.C = cs('H9', 'D9', 'SK');
  pickDiscard(s, 'C', s.discard.length - 1, { meldCardIds: ['H9', 'D9'] });
  // playerStates.C.firstMeldTurn ถูกตั้ง = turnNo ปัจจุบัน (3) จาก placeMeld → มืด
  s.hands.A = cs('S2'); s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.D = cs('S3'); s.playerStates.D = { hasMelded: true, firstMeldTurn: 1 };
  knock(s, 'C', 'SK', () => 0);
  const ev = s.events.find((e) => e.type === 'KNOCK_NGOH');
  assert.ok(ev); assert.match(ev.note, /ชนมืด/);
  const t = totals(s);
  assert.equal(t.C, 24); assert.equal(t.B, -24);
  assert.ok(isZeroSum(t));
});

test('ไม่โง่: น็อคด้วยการจั่วกอง (ไม่ได้เก็บกองทิ้งสด) → placement ปกติ', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3; s.headId = 'D9';
  s.melds = [
    { id: 'm1', type: 'RUN', ownerId: 'A', cards: cs('S4','S5','S6').map((x)=>({card:x,placedBy:'A'})) },
    { id: 'm2', type: 'SET', ownerId: 'A', cards: cs('H7','D7','C7').map((x)=>({card:x,placedBy:'A'})) },
  ];
  s.hands.A = cs('SK'); s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.B = cs('S2','H3'); s.playerStates.B = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.C = cs('SA'); s.playerStates.C = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.D = cs('DK'); s.playerStates.D = { hasMelded: true, firstMeldTurn: 1 };
  knock(s, 'A', 'SK', () => 0);
  assert.ok(s.events.some((e) => e.type === 'KNOCK'));
  assert.ok(!s.events.some((e) => e.type === 'KNOCK_NGOH'));
});

test('knock: น็อคสำเร็จ → ผู้ชนะ + จบรอบ + zero-sum + มี event KNOCK', () => {
  const s = startRound({ playerIds: P });
  // จัดฉากน็อค: A เกิด 2 ชุด (6 ใบ) เหลือใบปิด 1
  s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 3; s.headId = 'D9';
  s.melds = [
    { id: 'm1', type: 'RUN', ownerId: 'A', cards: cs('S4', 'S5', 'S6').map((x) => ({ card: x, placedBy: 'A' })) },
    { id: 'm2', type: 'SET', ownerId: 'A', cards: cs('H7', 'D7', 'C7').map((x) => ({ card: x, placedBy: 'A' })) },
  ];
  s.hands.A = cs('SK');                       // ใบปิด
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.B = cs('S2', 'H3'); s.playerStates.B = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.C = cs('SA'); s.playerStates.C = { hasMelded: true, firstMeldTurn: 1 };
  s.hands.D = cs('SQ', 'DK'); s.playerStates.D = { hasMelded: false, firstMeldTurn: null }; // มืด + ถือ SQ(สเปโต)

  knock(s, 'A', 'SK', () => 0);
  assert.equal(s.status, 'ENDED');
  assert.equal(s.winnerId, 'A');
  assert.ok(s.events.some((e) => e.type === 'KNOCK'));
  assert.ok(s.events.some((e) => e.type === 'AM_SPETO')); // D อม SQ
  assert.ok(isZeroSum(totals(s)));            // เงินสมดุล
  assert.ok(totals(s).A > 0);                 // ผู้ชนะได้คะแนนบวก
});

test('ตาสุดท้าย: ทิ้งใบจั่วสุดท้าย → คนถัดไปเข้าตาสุดท้าย (จั่วไม่ได้)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 0; s.turnNo = 9;
  s.stock = cs('S5');                            // เหลือใบจั่วใบเดียว
  s.hands.A = cs('H2', 'H3', 'SK');
  drawStock(s, 'A');                             // A จั่วใบสุดท้าย → กองหมด
  assert.equal(s.stock.length, 0);
  assert.equal(s.lastTurn, false);               // A ยังเล่นตาปกติ
  discard(s, 'A', 'SK');                         // A ทิ้ง (ไม่น็อค) → B เข้าตาสุดท้าย
  assert.equal(s.lastTurn, true);
  assert.equal(s.currentSeat, 1);
  const acts = allowedActions(s, 'B');
  assert.ok(!acts.includes('DRAW_STOCK'));       // จั่วไม่ได้
  assert.ok(acts.includes('PICK_DISCARD') && acts.includes('PASS'));
});

test('ตาสุดท้าย: จั่วไม่ได้ + ผ่าน → จบรอบ จัดอันดับแต้มสุทธิ (zero-sum)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 1; s.turnNo = 10;
  s.stock = []; s.lastTurn = true;
  s.melds = [{ id: 'm1', type: 'SET', ownerId: 'B', cards: cs('S7','H7','D7').map((x)=>({card:x,placedBy:'B'})) }];
  s.playerStates.B = { hasMelded: true, firstMeldTurn: 3 };
  s.hands.A = cs('SK'); s.hands.B = cs('S6'); s.hands.C = cs('SQ','SJ'); s.hands.D = cs('S8');
  ['A','C','D'].forEach((id) => { s.playerStates[id] = { hasMelded: false, firstMeldTurn: null }; });
  assert.deepEqual(allowedActions(s, 'B'), ['PICK_DISCARD', 'PASS']);
  assert.throws(() => drawStock(s, 'B'), /กองจั่วหมด/);
  passTurn(s, 'B');
  assert.equal(s.status, 'ENDED');
  assert.ok(s.events.some((e) => e.type === 'STOCK_OUT'));
  assert.ok(isZeroSum(totals(s)));
});

test('ตาสุดท้าย: เก็บกอง+น็อค → จบแบบมีคนน็อค (เป็นโง่ เพราะเก็บไพ่สด)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 2; s.turnNo = 11;
  s.stock = []; s.lastTurn = true;
  s.discard = cs('H3', 'S9'); s.discardInfo = { S9: { by: 'B', turnNo: 10 } }; // B ทิ้ง S9 ตาที่แล้ว
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'C', cards: cs('H4','H5','H6').map((x)=>({card:x,placedBy:'C'})) }];
  s.playerStates.C = { hasMelded: true, firstMeldTurn: 5 };
  s.hands.C = cs('H9', 'D9', 'SK');
  pickDiscard(s, 'C', s.discard.length - 1, { meldCardIds: ['H9', 'D9'] }); // เก็บ S9 เกิดตอง 9
  assert.equal(s.hands.C.length, 1);
  ['A','B','D'].forEach((id) => { s.hands[id] = cs('S2'); s.playerStates[id] = { hasMelded: true, firstMeldTurn: 1 }; });
  knock(s, 'C', 'SK', () => 0);
  assert.equal(s.status, 'ENDED');
  assert.ok(s.events.some((e) => e.type === 'KNOCK_NGOH')); // เก็บไพ่สดน็อค = โง่
  assert.ok(isZeroSum(totals(s)));
});

test('ตาสุดท้าย: เก็บกองแล้วทิ้ง (ไม่น็อค) → จบรอบทันที', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 1; s.turnNo = 12;
  s.stock = []; s.lastTurn = true;
  s.discard = cs('H3', 'S9'); s.discardInfo = { S9: { by: 'A', turnNo: 11 } };
  s.hands.B = cs('H9', 'D9', 'SK', 'SA'); s.playerStates.B = { hasMelded: false, firstMeldTurn: null };
  pickDiscard(s, 'B', s.discard.length - 1, { meldCardIds: ['H9', 'D9'] }); // เกิด 9 เหลือ SK,SA
  assert.equal(s.phase, 'ACTION');
  ['A','C','D'].forEach((id) => { s.hands[id] = cs('S2'); s.playerStates[id] = { hasMelded: true, firstMeldTurn: 1 }; });
  discard(s, 'B', 'SK');                          // ทิ้ง (ไม่น็อค) → จบรอบ
  assert.equal(s.status, 'ENDED');
  assert.ok(s.events.some((e) => e.type === 'STOCK_OUT'));
  assert.ok(isZeroSum(totals(s)));
});

test('หมุนเจ้ามือ: ตามทิศ (+1 ปกติ, −1 เมื่อวนทิศจากโง่)', () => {
  const s = startRound({ playerIds: P, dealerSeat: 0 });
  assert.equal(nextDealerSeat(s), 1);
  s.direction = -1;
  assert.equal(nextDealerSeat(s), 3);            // (0−1+4)%4 = 3
  s.dealerSeat = 2; s.direction = 1;
  assert.equal(nextDealerSeat(s), 3);
});

test('startRound รับ direction (วนทิศคงอยู่ข้ามรอบ)', () => {
  const s = startRound({ playerIds: P, dealerSeat: 1, direction: -1 });
  assert.equal(s.direction, -1);
  s.phase = 'ACTION'; s.currentSeat = 1; s.hands.B = cs('H2', 'H3', 'SK');
  discard(s, 'B', 'SK');
  assert.equal(s.currentSeat, 0);                // เล่นทวน: 1 + (−1) = 0
});

test('กองหมด: ผู้ชนะถือสเปโต(ไม่ได้เกิด) → เสียค่าอมด้วย (ไม่ยกเว้นผู้ชนะ)', () => {
  const s = startRound({ playerIds: P });
  s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 1; s.turnNo = 15; s.stock = []; s.lastTurn = true;
  s.melds = [{ id: 'm1', type: 'RUN', ownerId: 'B',
    cards: cs('S3','S4','S5','S6','S7','S8','S9').map((x) => ({ card: x, placedBy: 'B' })) }];
  s.playerStates.B = { hasMelded: true, firstMeldTurn: 3, hasPlayed: true, shownSpeto: false };
  s.hands.B = cs('C2');                           // ถือสเปโต C2 (net = 35 − 50 = −15)
  ['A','C','D'].forEach((id) => {
    s.hands[id] = cs('SA','SK','S10');            // net −35 (ไม่มีสเปโต)
    s.playerStates[id] = { hasMelded: false, firstMeldTurn: null, hasPlayed: true, shownSpeto: false };
  });
  passTurn(s, 'B', () => 0);
  assert.equal(s.winnerId, 'B');                  // แต้มสูงสุด
  const am = s.events.filter((e) => e.type === 'AM_SPETO');
  assert.equal(am.length, 1); assert.equal(am[0].by, 'B'); // ผู้ชนะถือสเปโต → เสียอม
  assert.ok(isZeroSum(totals(s)));
});

test('กองหมด: แต้มเท่ากัน → สุ่มผู้ชนะ (rng คุมได้)', () => {
  const mk = () => {
    const s = startRound({ playerIds: P });
    s.headId = 'X0'; s.phase = 'DRAW'; s.currentSeat = 0; s.turnNo = 15; s.stock = []; s.lastTurn = true;
    P.forEach((id) => {
      s.hands[id] = cs('S5');                      // ทุกคน net เท่ากัน (−5)
      s.playerStates[id] = { hasMelded: true, firstMeldTurn: 1, hasPlayed: true, shownSpeto: false };
    });
    return s;
  };
  const a = mk(); passTurn(a, 'A', () => 0.9);
  const b = mk(); passTurn(b, 'A', () => 0.1);
  assert.ok(isZeroSum(totals(a))); assert.ok(isZeroSum(totals(b)));
  assert.ok(a.winnerId && b.winnerId);            // มีผู้ชนะเสมอ (สุ่มจากคู่ที่เท่า)
});

test('knock type: น็อคมืด (เกิดครั้งแรกตานี้) + น็อคสี (ดอกเดียวล้วน)', () => {
  const s = startRound({ playerIds: P });
  s.phase = 'ACTION'; s.currentSeat = 0; s.turnNo = 5; s.headId = 'D9';
  // A เกิดทั้งหมดเป็นโพดำล้วน ในตานี้ (turn 5) = มืด + สี
  s.melds = [
    { id: 'm1', type: 'RUN', ownerId: 'A', cards: cs('S4', 'S5', 'S6').map((x) => ({ card: x, placedBy: 'A' })) },
    { id: 'm2', type: 'RUN', ownerId: 'A', cards: cs('S8', 'S9', 'S10').map((x) => ({ card: x, placedBy: 'A' })) },
  ];
  s.hands.A = cs('SK');
  s.playerStates.A = { hasMelded: true, firstMeldTurn: 5 }; // เกิดครั้งแรกตานี้ = มืด
  ['B', 'C', 'D'].forEach((id) => { s.hands[id] = cs('H3'); s.playerStates[id] = { hasMelded: false, firstMeldTurn: null }; });

  knock(s, 'A', 'SK', () => 0);
  const ev = s.events.find((e) => e.type === 'KNOCK');
  assert.match(ev.note, /darkColor/);         // มืด + สี → มืดสี
  assert.ok(isZeroSum(totals(s)));
});
