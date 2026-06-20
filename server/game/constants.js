// ค่าคงที่ของเกมดัมมี่ — ดอกไพ่ เลขไพ่ สเปโต และแต้มหน้าไพ่
// อ้างอิงกติกา: docs/01-กติกาเกม.md

// ดอกไพ่ (รหัส 1 ตัว): S=โพดำ H=โพแดง D=ข้าวหลามตัด C=ดอกจิก
export const SUITS = Object.freeze(['S', 'H', 'D', 'C']);
export const SUIT_NAME = Object.freeze({ S: 'โพดำ', H: 'โพแดง', D: 'ข้าวหลามตัด', C: 'ดอกจิก' });
export const SUIT_SYMBOL = Object.freeze({ S: '♠', H: '♥', D: '♦', C: '♣' });

// เลขไพ่ (เรียงจากต่ำไปสูง — A สูงสุดในเกมนี้)
export const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);

// ลำดับสำหรับตรวจ "เรียง" (A เป็นตัวสูงเท่านั้น: Q-K-A ได้ / A-2-3 ไม่ได้)
export const RANK_ORDER = Object.freeze({
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
});

// สเปโต = 2 ดอกจิก (C2) และ ควีนโพดำ (SQ)
export const SPETO_IDS = Object.freeze(['C2', 'SQ']);

// แต้มหน้าไพ่สำหรับ "จัดอันดับผู้แพ้" (2-9=5, หัวสูง=10, A=15)
// หมายเหตุ: สเปโตค้างมือ=50, ไพ่หัวที่เกิด=50/100 คิดแยกในขั้นคะแนน (scoring)
export function faceValue(rank) {
  if (rank === 'A') return 15;
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return 5; // 2–9
}

// รหัสไพ่ไม่ซ้ำ เช่น "SA"=A โพดำ, "C2"=2 ดอกจิก, "D10"=10 ข้าวหลามตัด
export function cardId(suit, rank) {
  return suit + rank;
}

export function isSpeto(card) {
  return SPETO_IDS.includes(card.id);
}
