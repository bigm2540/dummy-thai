// เทส M1: สำรับไพ่ + ค่าคงที่
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, shuffle, deal } from '../server/game/deck.js';
import { isSpeto, faceValue, SPETO_IDS } from '../server/game/constants.js';

test('buildDeck สร้างไพ่ 52 ใบ ไม่ซ้ำ', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
});

test('สเปโตคือ 2♣ (C2) และ Q♠ (SQ)', () => {
  assert.deepEqual([...SPETO_IDS].sort(), ['C2', 'SQ']);
  assert.ok(isSpeto({ id: 'C2' }));
  assert.ok(isSpeto({ id: 'SQ' }));
  assert.ok(!isSpeto({ id: 'CA' }));
  assert.ok(!isSpeto({ id: 'S2' })); // 2 โพดำ ไม่ใช่สเปโต
});

test('แต้มหน้าไพ่: 2-9=5, หัวสูง=10, A=15', () => {
  assert.equal(faceValue('2'), 5);
  assert.equal(faceValue('9'), 5);
  assert.equal(faceValue('10'), 10);
  assert.equal(faceValue('J'), 10);
  assert.equal(faceValue('K'), 10);
  assert.equal(faceValue('A'), 15);
});

test('shuffle ไม่ทำไพ่หาย/ซ้ำ และไม่แก้ของเดิม', () => {
  const deck = buildDeck();
  const shuffled = shuffle(deck);
  assert.equal(shuffled.length, 52);
  assert.deepEqual(
    shuffled.map((c) => c.id).sort(),
    deck.map((c) => c.id).sort(),
  );
  assert.notEqual(shuffled, deck); // เป็นสำรับใหม่
});

test('shuffle ด้วย rng คงที่ คาดเดาผลได้', () => {
  const deck = buildDeck();
  const a = shuffle(deck, () => 0); // rng=0 → ผลเดิมทุกครั้ง
  const b = shuffle(deck, () => 0);
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
});

test('deal: 4 คน คนละ 7 ใบ + ไพ่หัว + กองจั่ว 23 + กองทิ้งเริ่มต้น', () => {
  const deck = buildDeck();
  const { hands, head, stock, discard } = deal(deck);

  assert.equal(hands.length, 4);
  hands.forEach((h) => assert.equal(h.length, 7));
  assert.ok(head);
  assert.equal(stock.length, 23); // 52 − (4×7) − 1
  assert.deepEqual(discard, [head]); // กองทิ้งเริ่มต้น = ไพ่หัว

  // รวมทุกใบครบ 52 ไม่ซ้ำ
  const all = [...hands.flat(), head, ...stock];
  assert.equal(all.length, 52);
  assert.equal(new Set(all.map((c) => c.id)).size, 52);
});

test('deal ไม่แก้สำรับเดิม', () => {
  const deck = buildDeck();
  deal(deck);
  assert.equal(deck.length, 52);
});

test('การ์ดถูก freeze (แก้ค่าไม่ได้)', () => {
  const deck = buildDeck();
  assert.ok(Object.isFrozen(deck[0]));
});

test('deal โยน error เมื่อไพ่ไม่พอ', () => {
  // 8 คน × 7 + 1 = 57 > 52
  assert.throws(() => deal(buildDeck(), { players: 8 }), /ไพ่ไม่พอ/);
});
