// สำรับไพ่: สร้าง / สับ / แจก
// อ้างอิงกติกา: docs/01-กติกาเกม.md ข้อ 4 (การเริ่มเกม)

import { SUITS, RANKS, cardId } from './constants.js';

// สร้างสำรับ 52 ใบ (ไม่ใช้โจ๊กเกอร์)
export function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      // freeze ไพ่แต่ละใบ — กันโค้ดอนาคตเผลอแก้ค่าไพ่
      deck.push(Object.freeze({ id: cardId(suit, rank), suit, rank }));
    }
  }
  return deck;
}

// สับไพ่แบบ Fisher–Yates — รับ rng ได้ (ใส่ค่าคงที่เพื่อให้เทสคาดเดาได้)
// คืนสำรับใหม่ ไม่แก้ของเดิม
export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// แจกไพ่: ผู้เล่น 4 คน คนละ 7 ใบ (แจกวนทีละใบเหมือนจริง),
// เปิดไพ่ใบบนสุดถัดมาเป็น "ไพ่หัว" (= กองทิ้งเริ่มต้น), ที่เหลือเป็นกองจั่ว
// ไม่แก้สำรับที่รับเข้ามา
export function deal(deck, { players = 4, handSize = 7 } = {}) {
  // กันไพ่ไม่พอ: ต้องมีอย่างน้อย (คน×ใบ) + 1 (ไพ่หัว)
  const needed = players * handSize + 1;
  if (deck.length < needed) {
    throw new Error(`ไพ่ไม่พอสำหรับแจก: ต้องการ ${needed} ใบ แต่มี ${deck.length} ใบ`);
  }

  const d = deck.slice();
  const hands = Array.from({ length: players }, () => []);

  for (let n = 0; n < handSize; n++) {
    for (let p = 0; p < players; p++) {
      hands[p].push(d.shift());
    }
  }

  const head = d.shift();   // ไพ่หัว
  const stock = d;          // กองจั่ว (ที่เหลือ)

  return { hands, head, stock, discard: [head] };
}
