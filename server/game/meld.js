// ชุดไพ่ (ตอง/เรียง) + การฝาก + กฎเก็บกอง
// อ้างอิงกติกา: docs/01-กติกาเกม.md ข้อ 5.1, 6

import { RANK_ORDER } from './constants.js';

// ตอง (Set): เลขเดียวกัน 3 ใบขึ้นไป ต่างดอกทั้งหมด (ห้ามดอกซ้ำ)
export function isValidSet(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return false;
  const suits = new Set(cards.map((c) => c.suit));
  return suits.size === cards.length; // ไม่มีดอกซ้ำ (สูงสุด 4 ใบ)
}

// เรียง (Run): ดอกเดียวกัน เรียงเลขติดกัน 3 ใบขึ้นไป
// A เป็นตัวสูงเท่านั้น (Q-K-A ได้ / A-2-3 ไม่ได้ / ต่อวนไม่ได้) — RANK_ORDER ให้ A=14
export function isValidRun(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const suit = cards[0].suit;
  if (!cards.every((c) => c.suit === suit)) return false;
  const orders = cards.map((c) => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] !== orders[i - 1] + 1) return false; // ต้องติดกัน ไม่ซ้ำ
  }
  return true;
}

// เป็นชุดที่ถูกต้องไหม (ตองหรือเรียง)
export function isValidMeld(cards) {
  return isValidSet(cards) || isValidRun(cards);
}

// ฝากได้ไหม: ไพ่ 1 ใบ ต่อเข้าชุดที่เกิดแล้ว (meldCards) ได้หรือไม่
export function canLayOff(card, meldCards) {
  if (isValidSet(meldCards)) {
    if (meldCards.length >= 4) return false; // ตองเต็ม 4 ดอกแล้ว
    return card.rank === meldCards[0].rank && !meldCards.some((c) => c.suit === card.suit);
  }
  if (isValidRun(meldCards)) {
    if (card.suit !== meldCards[0].suit) return false;
    const orders = meldCards.map((c) => RANK_ORDER[c.rank]);
    const min = Math.min(...orders);
    const max = Math.max(...orders);
    const v = RANK_ORDER[card.rank];
    return v === min - 1 || v === max + 1; // ต่อหัวหรือท้าย (A สูงสุด=14 ต่อวนไม่ได้)
  }
  return false;
}

// กฎเก็บกอง: ขุดกองทิ้งจาก targetIndex ขึ้นไปถึงใบบนสุด
// discard: index 0 = ก้นกอง (ไพ่หัว) ... ใบท้าย = บนสุด
// คืน { target, picked, remaining }
//  - target   = ใบเป้าหมาย (ต้องเอาไปเกิด/ฝากทันที)
//  - picked   = ใบที่อยู่เหนือเป้าหมาย (เก็บเข้ามือได้)
//  - remaining = กองทิ้งที่เหลือ (ต่ำกว่าเป้าหมาย)
export function digDiscard(discard, targetIndex) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= discard.length) {
    throw new Error(`ตำแหน่งขุดกองทิ้งไม่ถูกต้อง: ${targetIndex}`);
  }
  const taken = discard.slice(targetIndex);
  return {
    target: taken[0],
    picked: taken.slice(1),
    remaining: discard.slice(0, targetIndex),
  };
}
