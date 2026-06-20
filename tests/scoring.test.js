// เทส M3: ระบบคะแนน (เทสหนัก — รวมโง่มืด, zero-sum, บังคับเสียมาก, ตัวอย่าง doc 07)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  deadwoodPoints, meldedPoints, playerNet,
  collectFromOthers, payToOthers, payOne,
  rankLosers, placementNormal, placementNgoh,
  aggregate, isZeroSum, toMoney,
} from '../server/game/scoring.js';

const c = (id) => ({ id, suit: id[0], rank: id.slice(1) });
const IDS = ['A', 'B', 'C', 'D'];
const sumAmts = (d) => d.reduce((s, x) => s + x.amount, 0);

// ---------- แต้มไพ่ ----------
test('deadwoodPoints: สเปโต=50, A=15, หัวสูง=10, เลข=5', () => {
  assert.equal(deadwoodPoints(c('C2')), 50); // สเปโต
  assert.equal(deadwoodPoints(c('SQ')), 50); // สเปโต
  assert.equal(deadwoodPoints(c('SA')), 15);
  assert.equal(deadwoodPoints(c('SK')), 10);
  assert.equal(deadwoodPoints(c('S5')), 5);
});

test('meldedPoints: ไพ่หัว=50, หัว+สเปโต=100, สเปโต=50, อื่น=หน้าไพ่', () => {
  assert.equal(meldedPoints(c('S5'), 'D9'), 5);
  assert.equal(meldedPoints(c('D9'), 'D9'), 50);   // เป็นไพ่หัว
  assert.equal(meldedPoints(c('C2'), 'D9'), 50);   // สเปโต (ไม่ใช่หัว)
  assert.equal(meldedPoints(c('C2'), 'C2'), 100);  // หัว + สเปโต
  assert.equal(meldedPoints(c('SK'), 'D9'), 10);
});

test('playerNet = เกิด − ค้างมือ', () => {
  const net = playerNet({ melded: [c('S5'), c('S6'), c('S7')], hand: [c('SA')] }, 'D9');
  assert.equal(net, (5 + 5 + 5) - 15); // 15 - 15 = 0
});

// ---------- delta helpers ----------
test('collectFromOthers (เกิดหัว +3/−1, โชว์ +6/−2) zero-sum', () => {
  const head = collectFromOthers('A', IDS, DEFAULT_CONFIG.bonus.headMeld);
  assert.equal(head.find((x) => x.id === 'A').amount, 3);
  assert.equal(head.find((x) => x.id === 'B').amount, -1);
  assert.equal(sumAmts(head), 0);

  const show = collectFromOthers('A', IDS, DEFAULT_CONFIG.bonus.showSpeto);
  assert.equal(show.find((x) => x.id === 'A').amount, 6);
  assert.equal(show.find((x) => x.id === 'B').amount, -2);
  assert.equal(sumAmts(show), 0);
});

test('payToOthers (ทิ้ง −3/+1, ปี้ −6/+2, อม −3/+1) zero-sum', () => {
  const ting = payToOthers('A', IDS, DEFAULT_CONFIG.tingPenalty);
  assert.equal(ting.find((x) => x.id === 'A').amount, -3);
  assert.equal(ting.find((x) => x.id === 'B').amount, 1);
  assert.equal(sumAmts(ting), 0);

  const pee = payToOthers('A', IDS, DEFAULT_CONFIG.peeBoth);
  assert.equal(pee.find((x) => x.id === 'A').amount, -6);
  assert.equal(sumAmts(pee), 0);
});

test('payOne (ฝากสเปโตคนอื่น, โง่) zero-sum', () => {
  const d = payOne('D', 'A', 3);
  assert.equal(d.find((x) => x.id === 'D').amount, -3);
  assert.equal(d.find((x) => x.id === 'A').amount, 3);
  assert.equal(sumAmts(d), 0);
});

// ---------- จัดอันดับผู้แพ้ ----------
test('rankLosers: ปกติ (แต้มสุทธิสูง=เสียน้อย)', () => {
  const r = rankLosers([
    { id: 'B', net: 10 }, { id: 'C', net: 5 }, { id: 'D', net: -3 },
  ]);
  assert.deepEqual(r, { B: -1, C: -2, D: -3 });
});

test('rankLosers: คนมืด/โง่ บังคับเสียมาก (−3) แม้แต้มดี', () => {
  const r = rankLosers([
    { id: 'B', net: 99, forcedBig: true }, // มืด แต่ net สูง → ยังเสียมาก
    { id: 'C', net: 5 },
    { id: 'D', net: 10 },
  ]);
  assert.equal(r.B, -3);          // บังคับเสียมาก
  assert.equal(r.D, -1);          // net สูงสุดในที่เหลือ = เสียน้อย
  assert.equal(r.C, -2);
});

test('rankLosers: หลายคนบังคับเสียมาก → −3 เท่ากัน', () => {
  const r = rankLosers([
    { id: 'B', forcedBig: true }, { id: 'C', forcedBig: true }, { id: 'D', net: 5 },
  ]);
  assert.equal(r.B, -3);
  assert.equal(r.C, -3);
  assert.equal(r.D, -1); // คนเดียวที่เหลือ = เสียน้อย
});

test('rankLosers: แต้มเท่ากัน → ได้ tier ครบ ไม่ซ้ำ (สุ่มด้วย rng คงที่)', () => {
  const r = rankLosers(
    [{ id: 'B', net: 5 }, { id: 'C', net: 5 }, { id: 'D', net: 0 }],
    DEFAULT_CONFIG, () => 0,
  );
  assert.deepEqual(Object.values(r).sort((a, b) => a - b), [-3, -2, -1]);
  assert.equal(r.D, -3); // net ต่ำสุดยังเสียมาก
});

// ---------- placement ----------
test('placementNormal: น็อคปกติ → ผู้ชนะ +6 / ผู้แพ้ −1−2−3 (zero-sum)', () => {
  const d = placementNormal('A',
    [{ id: 'B', net: 10 }, { id: 'C', net: 5 }, { id: 'D', net: -3 }], 'normal');
  assert.equal(d.A, 6);
  assert.equal(d.B, -1); assert.equal(d.C, -2); assert.equal(d.D, -3);
  assert.ok(isZeroSum(d));
});

test('placementNormal: น็อคมืด ×2 → ผู้ชนะ +12 / ผู้แพ้ −2−4−6', () => {
  const d = placementNormal('A',
    [{ id: 'B', net: 10 }, { id: 'C', net: 5 }, { id: 'D', net: -3 }], 'dark');
  assert.equal(d.A, 12);
  assert.deepEqual([d.B, d.C, d.D].sort((a, b) => a - b), [-6, -4, -2]);
  assert.ok(isZeroSum(d));
});

test('placementNgoh: โง่ +6/−6, โง่มืด +12/−12, คนอื่น 0', () => {
  const ngoh = placementNgoh('C', 'B', 'normal');
  assert.equal(ngoh.C, 6); assert.equal(ngoh.B, -6);
  assert.ok(isZeroSum(ngoh));

  const dark = placementNgoh('C', 'B', 'dark');
  assert.equal(dark.C, 12); assert.equal(dark.B, -12);
  assert.equal(dark.A, undefined); // คนอื่นไม่เสีย
});

// ---------- เงิน ----------
test('toMoney', () => {
  assert.equal(toMoney(14, 5), 70);
  assert.equal(toMoney(-12, 5), -60);
});

// ---------- INTEGRATION: ตัวอย่างจาก doc 07 ----------
test('doc 07 §3.1 — รอบที่มีโง่มืด → A+6 B−13 C+11 D−4 (zero-sum)', () => {
  // A เกิดหัว · A ฝากสเปโต Q♠ เข้าชุด D · B ทิ้ง→C น็อคมืด (B โง่มืด)
  const totals = aggregate(
    collectFromOthers('A', IDS, DEFAULT_CONFIG.bonus.headMeld), // เกิดหัว
    payOne('D', 'A', DEFAULT_CONFIG.spetoLayoffOther),          // ฝากสเปโต: D−3, A+3
    placementNgoh('C', 'B', 'dark'),                            // โง่มืด: C+12, B−12
  );
  assert.equal(totals.A, 6);
  assert.equal(totals.B, -13);
  assert.equal(totals.C, 11);
  assert.equal(totals.D, -4);
  assert.ok(isZeroSum(totals));
  // เงิน เรท 5
  assert.equal(toMoney(totals.B, 5), -65);
});

test('doc 07 §3 — A น็อค + เกิดหัว + D อมสเปโต → A+10 B−1 C−2 D−7 (zero-sum)', () => {
  const totals = aggregate(
    placementNormal('A',
      [{ id: 'B', net: 10 }, { id: 'C', net: 5 }, { id: 'D', net: -3 }], 'normal'), // A+6,B−1,C−2,D−3
    collectFromOthers('A', IDS, DEFAULT_CONFIG.bonus.headMeld),  // เกิดหัว A+3, others−1
    payToOthers('D', IDS, DEFAULT_CONFIG.amSpeto),               // อมสเปโต D−3, others+1
  );
  assert.equal(totals.A, 10);
  assert.equal(totals.B, -1);
  assert.equal(totals.C, -2);
  assert.equal(totals.D, -7);
  assert.ok(isZeroSum(totals));
});
