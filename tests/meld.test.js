// เทส M2: ชุดไพ่ (ตอง/เรียง) + ฝาก + เก็บกอง
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSet, isValidRun, isValidMeld, canLayOff, digDiscard,
} from '../server/game/meld.js';

// helper: "H7" → {id:'H7', suit:'H', rank:'7'} (รองรับ rank '10')
const c = (id) => ({ id, suit: id[0], rank: id.slice(1) });
const cards = (...ids) => ids.map(c);

test('ตอง (Set): ถูกต้อง', () => {
  assert.ok(isValidSet(cards('S7', 'H7', 'D7')));      // 3 ใบ ต่างดอก
  assert.ok(isValidSet(cards('S7', 'H7', 'D7', 'C7'))); // 4 ใบ
});

test('ตอง (Set): ผิด', () => {
  assert.ok(!isValidSet(cards('S7', 'H7')));            // < 3 ใบ
  assert.ok(!isValidSet(cards('S7', 'H7', 'S7')));      // ดอกซ้ำ
  assert.ok(!isValidSet(cards('S7', 'H7', 'D8')));      // เลขไม่ตรง
});

test('เรียง (Run): ถูกต้อง + A สูง (Q-K-A)', () => {
  assert.ok(isValidRun(cards('H4', 'H5', 'H6')));
  assert.ok(isValidRun(cards('SQ', 'SK', 'SA')));       // Q-K-A ได้
  assert.ok(isValidRun(cards('H6', 'H4', 'H5')));       // สลับลำดับ input ก็ได้
});

test('เรียง (Run): ผิด', () => {
  assert.ok(!isValidRun(cards('SA', 'S2', 'S3')));      // A-2-3 ไม่ได้ (A สูง)
  assert.ok(!isValidRun(cards('SK', 'SA', 'S2')));      // ต่อวนไม่ได้
  assert.ok(!isValidRun(cards('H4', 'S5', 'H6')));      // คนละดอก
  assert.ok(!isValidRun(cards('H4', 'H5')));            // < 3 ใบ
  assert.ok(!isValidRun(cards('H4', 'H6', 'H7')));      // ไม่ติดกัน
});

test('isValidMeld = ตอง หรือ เรียง', () => {
  assert.ok(isValidMeld(cards('S7', 'H7', 'D7')));
  assert.ok(isValidMeld(cards('H4', 'H5', 'H6')));
  assert.ok(!isValidMeld(cards('S7', 'H8', 'D9')));
});

test('ฝากเข้าตอง', () => {
  const set3 = cards('S7', 'H7', 'D7');
  assert.ok(canLayOff(c('C7'), set3));                 // ดอกที่ 4 ได้
  assert.ok(!canLayOff(c('S7'), set3));                // ดอกซ้ำ ไม่ได้
  assert.ok(!canLayOff(c('C8'), set3));                // เลขไม่ตรง
  const set4 = cards('S7', 'H7', 'D7', 'C7');
  assert.ok(!canLayOff(c('S7'), set4));                // ตองเต็ม 4 แล้ว
});

test('ฝากเข้าเรียง (ต่อหัว/ท้าย, A สูงต่อวนไม่ได้)', () => {
  const run = cards('H4', 'H5', 'H6');
  assert.ok(canLayOff(c('H7'), run));                  // ต่อท้าย
  assert.ok(canLayOff(c('H3'), run));                  // ต่อหัว
  assert.ok(!canLayOff(c('H8'), run));                 // เว้นช่อง
  assert.ok(!canLayOff(c('S7'), run));                 // คนละดอก
  const runTop = cards('SQ', 'SK', 'SA');
  assert.ok(canLayOff(c('SJ'), runTop));               // ต่อหัว (J)
  assert.ok(!canLayOff(c('S2'), runTop));              // ต่อบน A ไม่ได้ (วน)
});

test('เก็บกอง: ขุดถูกตำแหน่ง', () => {
  // index0=ก้นกอง(D9) ... index4=บนสุด(S3)
  const discard = cards('D9', 'H7', 'SK', 'C6', 'S3');
  const { target, picked, remaining } = digDiscard(discard, 2); // เอา SK
  assert.equal(target.id, 'SK');
  assert.deepEqual(picked.map((x) => x.id), ['C6', 'S3']);      // ใบเหนือเป้าหมาย → เข้ามือ
  assert.deepEqual(remaining.map((x) => x.id), ['D9', 'H7']);   // กองที่เหลือ
});

test('เก็บกอง: ตำแหน่งผิด → error', () => {
  const discard = cards('D9', 'H7');
  assert.throws(() => digDiscard(discard, 5), /ไม่ถูกต้อง/);
  assert.throws(() => digDiscard(discard, -1), /ไม่ถูกต้อง/);
});
