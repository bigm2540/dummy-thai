// ระบบคะแนน — แต้มสุทธิ, จัดอันดับ, คะแนนน็อค, โบนัส, บทลงโทษ (zero-sum)
// อ้างอิง: docs/01-กติกาเกม.md ข้อ 7-9 · docs/07-การคิดเงิน.md

import { faceValue, isSpeto } from './constants.js';

// ค่าคะแนนทั้งหมด (custom ได้ตอนสร้างห้อง)
export const DEFAULT_CONFIG = Object.freeze({
  knockWin: 6,                                   // คะแนนน็อคพื้นฐาน
  lossTiers: [-1, -2, -3],                        // เสียน้อย / กลาง / มาก
  knockMultiplier: { normal: 1, dark: 2, color: 2, darkColor: 4 },
  // โบนัส: perOther = คนอื่นจ่ายคนละเท่าไร (ผู้ทำได้ = perOther × จำนวนคนอื่น) → zero-sum
  bonus: { headMeld: 1, spetoMeld: 1, closeCard: 1, showSpeto: 2 },
  spetoLayoffOther: 3,                            // ฝากสเปโตเข้าชุดคนอื่น (1-ต่อ-1)
  spetoLayoffSelf: 1,                             // ฝากเข้าชุดตัวเอง (คนอื่นจ่ายคนละ)
  tingPenalty: 1,                                 // ทิ้งดัมมี่/เต็ม (คนทิ้งจ่ายคนอื่นคนละ)
  peeBoth: 2, peeSingle: 1,                        // ปี้ (คนทิ้งจ่ายคนอื่นคนละ)
  amSpeto: 1,                                     // อมสเปโต (ผู้อมจ่ายคนอื่นคนละ ต่อ 1 ใบ)
  moneyRate: 1,                                   // บาทต่อคะแนน
});

// ---------- แต้มไพ่ (สำหรับจัดอันดับ) ----------

// ไพ่ค้างมือ: สเปโต=50, อื่นๆ=หน้าไพ่
export function deadwoodPoints(card) {
  return isSpeto(card) ? 50 : faceValue(card.rank);
}

// ไพ่ที่เกิด: ไพ่หัว=50 (100 ถ้าเป็นสเปโต), สเปโต=50, อื่นๆ=หน้าไพ่
export function meldedPoints(card, headId) {
  if (card.id === headId) return isSpeto(card) ? 100 : 50;
  if (isSpeto(card)) return 50;
  return faceValue(card.rank);
}

// แต้มสุทธิ = แต้มที่เกิด − แต้มค้างมือ
export function playerNet({ melded = [], hand = [] }, headId) {
  const m = melded.reduce((s, c) => s + meldedPoints(c, headId), 0);
  const h = hand.reduce((s, c) => s + deadwoodPoints(c), 0);
  return m - h;
}

// ---------- delta helpers (ทุกตัว zero-sum) ----------
// คืน array ของ { id, amount }

// ผู้ทำเก็บจากคนอื่นคนละ perOther (เกิดหัว/สเปโต/ใบปิด/โชว์/ฝากตัวเอง)
export function collectFromOthers(achieverId, allIds, perOther) {
  const others = allIds.filter((id) => id !== achieverId);
  return [
    { id: achieverId, amount: perOther * others.length },
    ...others.map((id) => ({ id, amount: -perOther })),
  ];
}

// ผู้ทำจ่ายให้คนอื่นคนละ perOther (ทิ้งดัมมี่/เต็ม, ปี้, อม)
export function payToOthers(actorId, allIds, perOther) {
  const others = allIds.filter((id) => id !== actorId);
  return [
    { id: actorId, amount: -perOther * others.length },
    ...others.map((id) => ({ id, amount: perOther })),
  ];
}

// โอน 1-ต่อ-1 (ฝากสเปโตคนอื่น, โง่)
export function payOne(fromId, toId, amount) {
  return [
    { id: fromId, amount: -amount },
    { id: toId, amount: amount },
  ];
}

// ---------- จัดอันดับผู้แพ้ ----------
// losers: [{ id, net, forcedBig }]  (forcedBig=true ถ้าโง่/มืด)
// คืน { [id]: tierAmount } (ก่อนคูณตัวคูณน็อค)
export function rankLosers(losers, config = DEFAULT_CONFIG, rng = Math.random) {
  const tiers = config.lossTiers;            // [-1,-2,-3] (น้อย→มาก)
  const bigTier = tiers[tiers.length - 1];   // -3
  const result = {};

  const forced = losers.filter((l) => l.forcedBig);
  const rest = losers.filter((l) => !l.forcedBig);

  for (const l of forced) result[l.id] = bigTier; // โง่/มืด = เสียมากเสมอ

  // ที่เหลือ: เรียง net มาก→น้อย (เสมอ → สุ่ม) ลงช่องที่เหลือ เริ่มจากเสียน้อย
  const sorted = [...rest].sort((a, b) => b.net - a.net || (rng() < 0.5 ? -1 : 1));
  const restTiers = tiers.slice(0, rest.length); // ช่องที่เหลือ (เริ่มจากเสียน้อย)
  sorted.forEach((l, i) => { result[l.id] = restTiers[i]; });

  return result;
}

// ---------- placement (ผลแพ้ชนะประจำรอบ) ----------

// น็อคปกติ: จัดอันดับผู้แพ้ → คูณตัวคูณ → คนน็อคเก็บผลรวม (zero-sum)
export function placementNormal(knockerId, losers, knockType, config = DEFAULT_CONFIG, rng = Math.random) {
  const mult = config.knockMultiplier[knockType] ?? 1;
  const ranked = rankLosers(losers, config, rng);
  const deltas = {};
  let sum = 0;
  for (const [id, tier] of Object.entries(ranked)) {
    deltas[id] = tier * mult;
    sum += deltas[id];
  }
  deltas[knockerId] = -sum; // คนน็อคได้ = ผลรวมที่ผู้แพ้เสีย
  return deltas;
}

// น็อคจากการโง่: คนโง่จ่ายแทนทั้งวง → คนน็อค +knockWin×mult, คนโง่ −เท่ากัน, คนอื่น 0
// multOverride: ใส่ตัวคูณตรงๆ (เช่น โง่มืดจนชนมืด = ×4) ทับค่าจาก knockType
export function placementNgoh(knockerId, foolId, knockType, config = DEFAULT_CONFIG, multOverride = null) {
  const mult = multOverride ?? config.knockMultiplier[knockType] ?? 1;
  const amount = config.knockWin * mult;
  return { [knockerId]: amount, [foolId]: -amount };
}

// ---------- รวม + เงิน ----------

// รวม delta หลายชุดเป็นคะแนนต่อคน
// รับได้ทั้ง array ของ {id, amount} (helpers) และ object {id: amount} (placement)
export function aggregate(...deltaLists) {
  const total = {};
  for (const d of deltaLists) {
    if (Array.isArray(d)) {
      for (const { id, amount } of d) total[id] = (total[id] || 0) + amount;
    } else {
      for (const [id, amount] of Object.entries(d)) total[id] = (total[id] || 0) + amount;
    }
  }
  return total;
}

// ตรวจ zero-sum (ผลรวมทุกคน = 0)
export function isZeroSum(totals) {
  return Object.values(totals).reduce((a, b) => a + b, 0) === 0;
}

// คะแนน → เงิน
export function toMoney(score, rate = DEFAULT_CONFIG.moneyRate) {
  return score * rate;
}
