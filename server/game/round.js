// เครื่องยนต์รอบ (M4a) — สถานะรอบ + ลำดับตา + เกิด/ฝาก/ทิ้ง/น็อค + คิดคะแนนจบรอบ
// อ้างอิง: docs/01-กติกาเกม.md, docs/02-ออกแบบ-data-model.md
// หมายเหตุ: เก็บกอง/เกิดหัว/บทลงโทษการทิ้ง(ปี้/โง่/ทิ้งดัมมี่-เต็ม)/วนทิศ = M4b

import { buildDeck, shuffle, deal } from './deck.js';
import { isValidSet, isValidRun, isValidMeld, canLayOff, digDiscard } from './meld.js';
import { isSpeto, RANK_ORDER, SPETO_IDS } from './constants.js';
import * as score from './scoring.js';

// ---------- helpers ----------
const currentPlayer = (s) => s.playerIds[s.currentSeat];
const cardsPlacedBy = (s, pid) =>
  s.melds.flatMap((m) => m.cards).filter((mc) => mc.placedBy === pid).map((mc) => mc.card);

function requireTurn(s, pid) {
  if (s.status !== 'PLAYING') throw new Error('รอบจบแล้ว');
  if (currentPlayer(s) !== pid) throw new Error('ยังไม่ถึงตาคุณ');
}
function requirePhase(s, phase) {
  if (s.phase !== phase) throw new Error(`ทำตอนนี้ไม่ได้ (ต้องเป็นช่วง ${phase})`);
}
function takeFromHand(s, pid, cardIds) {
  const hand = s.hands[pid];
  const taken = [];
  for (const id of cardIds) {
    const i = hand.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`ไม่มีไพ่ ${id} ในมือ`);
    taken.push(hand[i]);
    hand.splice(i, 1);
  }
  return taken;
}
function objToDeltas(obj) {
  return Object.entries(obj).map(([id, amount]) => ({ id, amount }));
}
function addEvent(s, deltas, type, by, note) {
  s.events.push({ type, by, note, turnNo: s.turnNo, deltas });
}
function advanceTurn(s) {
  const n = s.playerIds.length;
  s.currentSeat = ((s.currentSeat + s.direction) % n + n) % n;
  s.turnNo += 1;
  s.phase = 'DRAW';
}

// คะแนนสะสมในรอบ (รวมทุก event)
export function totals(s) {
  return score.aggregate(...s.events.map((e) => e.deltas));
}

// ---------- เริ่มรอบ ----------
// direction: ทิศเล่น (+1 ตามเข็ม / −1 ทวน) — ส่งต่อจากรอบก่อน (โง่ทำให้วนกลับด้านถาวรจนกว่าจะโง่อีก)
export function startRound({ playerIds, dealerSeat = 0, direction = 1, config = score.DEFAULT_CONFIG, deck } = {}) {
  const dk = deck || shuffle(buildDeck());
  const dealt = deal(dk, { players: playerIds.length });
  const hands = {};
  const playerStates = {};
  playerIds.forEach((id, i) => {
    hands[id] = dealt.hands[i];
    playerStates[id] = { hasMelded: false, firstMeldTurn: null, shownSpeto: false, hasPlayed: false };
  });
  return {
    playerIds,
    dealerSeat,
    currentSeat: dealerSeat,
    direction,
    turnNo: 1,
    phase: 'DRAW',
    stock: dealt.stock,
    discard: dealt.discard, // [head]
    headId: dealt.head.id,
    melds: [],
    meldSeq: 0,
    headMelded: false, // เกิดหัวได้ครั้งเดียวต่อรอบ
    discardInfo: {},   // { [cardId]: { by, turnNo } } — ใครทิ้ง/ตาไหน (สำหรับปี้/โง่) ไพ่หัวไม่นับ
    foolPickup: null,  // { knocker, turnNo, fool } — มีคนเก็บกองทิ้งสดตาที่แล้ว (ถ้าน็อคตานี้ = โง่)
    lastTurn: false,   // ตาสุดท้าย (กองจั่วหมด) — จั่วไม่ได้ เก็บกอง+น็อคเท่านั้น
    hands,
    playerStates,
    status: 'PLAYING',
    winnerId: null,
    events: [],
    config,
  };
}

// ---------- ขั้นจั่ว ----------
export function drawStock(s, pid) {
  requireTurn(s, pid);
  requirePhase(s, 'DRAW');
  s.playerStates[pid].hasPlayed = true; // เริ่มเล่นตาตัวเอง → หมดสิทธิ์โชว์สเปโต
  if (s.stock.length === 0) {
    throw new Error('กองจั่วหมด — ตาสุดท้าย จั่วไม่ได้ (เก็บกองแล้วน็อค หรือผ่าน)');
  }
  s.hands[pid].push(s.stock.shift());
  s.phase = 'ACTION';
  return s;
}

// ผ่านตาสุดท้าย (ไม่น็อค) → จบรอบทันที จัดอันดับแต้มสุทธิ
export function passTurn(s, pid, rng = Math.random) {
  requireTurn(s, pid);
  s.playerStates[pid].hasPlayed = true;
  if (!s.lastTurn) throw new Error('ผ่านตาได้เฉพาะตาสุดท้าย (กองจั่วหมด)');
  endRoundStockOut(s, rng);
  return s;
}

// เก็บกอง: ขุดกองทิ้งจาก targetIndex — ใบเป้าหมายต้องเอาไปเกิด/ฝากทันที, ที่เหลือเข้ามือ
// plan: { meldCardIds: [...] } เกิด target+ไพ่ในมือ  หรือ  { layoffMeldId } ฝาก target เข้าชุด
export function pickDiscard(s, pid, targetIndex, plan = {}) {
  requireTurn(s, pid);
  requirePhase(s, 'DRAW');
  s.playerStates[pid].hasPlayed = true; // เริ่มเล่นตาตัวเอง → หมดสิทธิ์โชว์สเปโต
  const topId = s.discard[s.discard.length - 1]?.id; // ใบบนสุด (ทิ้งสดตาที่แล้ว) — ใช้ตัดสินโง่
  const { target, picked, remaining } = digDiscard(s.discard, targetIndex);

  if (plan.meldCardIds) {
    // ไพ่ที่จะเอามาเข้าชุดกับ target ได้ทั้งจาก "มือ" และ "ใบที่ขุดติดมา" (picked)
    const fromHand = [];
    const meldExtra = plan.meldCardIds.map((id) => {
      const inPicked = picked.find((c) => c.id === id);
      if (inPicked) return inPicked;
      const inHand = s.hands[pid].find((c) => c.id === id);
      if (inHand) { fromHand.push(id); return inHand; }
      throw new Error(`ไม่มีไพ่ ${id} ในมือหรือในกองที่ขุด`);
    });
    const cards = [target, ...meldExtra];
    if (!isValidMeld(cards)) throw new Error('ไพ่ที่ขุดประกอบเป็นชุดไม่ได้');
    const pickedUnused = picked.filter((c) => !plan.meldCardIds.includes(c.id));
    if (s.hands[pid].length - fromHand.length + pickedUnused.length < 1) {
      throw new Error('ต้องเหลือใบปิดอย่างน้อย 1 ใบ — ถ้าจะลงหมดให้น็อค');
    }
    s.discard = remaining;
    takeFromHand(s, pid, fromHand);
    s.hands[pid].push(...pickedUnused);
    placeMeld(s, pid, cards);
    applyMeldBonuses(s, pid, cards);
    applyPee(s, pid, cards); // ปี้: ใบที่คนอื่นทิ้งสด → ถูกเอามาเกิดหัว/สเปโต
  } else if (plan.layoffMeldId) {
    if (!s.playerStates[pid].hasMelded) throw new Error('ต้องเกิดของตัวเองก่อนถึงจะฝากได้');
    const m = s.melds.find((x) => x.id === plan.layoffMeldId);
    if (!m) throw new Error('ไม่พบชุดที่จะฝาก');
    if (!canLayOff(target, m.cards.map((mc) => mc.card))) throw new Error('ไพ่ที่ขุดฝากเข้าชุดนี้ไม่ได้');
    s.discard = remaining;
    s.hands[pid].push(...picked);
    m.cards.push({ card: target, placedBy: pid });
    applyLayoffBonuses(s, pid, m, target); // เกิดหัว(ฝาก)/ฝากสเปโต — ไม่ใช่เกิดสเปโต
  } else {
    throw new Error('เก็บกองต้องระบุว่าจะเอาใบเป้าหมายไปเกิดหรือฝาก');
  }

  // บันทึก "เก็บกองทิ้งสด" — ใบบนสุดถูกทิ้งตาที่แล้ว → ถ้าน็อคตานี้ คนทิ้งใบนั้น = โง่
  const top = topId && s.discardInfo[topId];
  s.foolPickup = (top && top.turnNo === s.turnNo - 1 && top.by !== pid)
    ? { knocker: pid, turnNo: s.turnNo, fool: top.by }
    : null;

  s.phase = 'ACTION';
  return s;
}

// ปี้: ในชุดที่เพิ่งเกิด ถ้ามีไพ่ที่ "คนอื่นทิ้งสดตาที่แล้ว" + ชุดนี้มีหัว/สเปโต → คนทิ้งโดนปี้
// โดนทั้งหัว+สเปโต = peeBoth (−2/คน), อย่างเดียว = peeSingle (−1/คน), มีผลแค่ 1 ตา
function applyPee(s, digger, meldCards) {
  const hasHead = meldCards.some((c) => c.id === s.headId);
  const hasSpeto = meldCards.some((c) => isSpeto(c));
  if (!hasHead && !hasSpeto) return;
  const per = hasHead && hasSpeto ? s.config.peeBoth : s.config.peeSingle;
  const note = hasHead && hasSpeto ? 'หัว+สเปโต' : hasHead ? 'หัว' : 'สเปโต';
  const billed = new Set();
  for (const c of meldCards) {
    const info = s.discardInfo[c.id];
    if (info && info.by !== digger && info.turnNo === s.turnNo - 1 && !billed.has(info.by)) {
      billed.add(info.by);
      addEvent(s, score.payToOthers(info.by, s.playerIds, per), 'PEE', info.by, `ปี้ ${note} (${c.id})`);
    }
  }
}

// ---------- ขั้นแอคชัน ----------
// วางชุดที่เกิดลงโต๊ะ + ตั้ง hasMelded/firstMeldTurn
function placeMeld(s, pid, cards) {
  const m = {
    id: `meld${++s.meldSeq}`,
    type: isValidSet(cards) ? 'SET' : 'RUN',
    ownerId: pid,
    cards: cards.map((c) => ({ card: c, placedBy: pid })),
  };
  s.melds.push(m);
  const ps = s.playerStates[pid];
  ps.hasMelded = true;
  if (ps.firstMeldTurn === null) ps.firstMeldTurn = s.turnNo;
  return m;
}

// โบนัสตอนเกิด: เกิดหัว (ครั้งเดียว/รอบ) + เกิดสเปโต (หัวอาจเป็นสเปโตได้ทั้งคู่)
function applyMeldBonuses(s, pid, cards) {
  for (const c of cards) {
    if (c.id === s.headId && !s.headMelded) {
      s.headMelded = true;
      addEvent(s, score.collectFromOthers(pid, s.playerIds, s.config.bonus.headMeld),
        'HEAD_MELD', pid, `เกิดหัว ${c.id}`);
    }
    if (isSpeto(c)) {
      addEvent(s, score.collectFromOthers(pid, s.playerIds, s.config.bonus.spetoMeld),
        'SPETO_MELD', pid, `เกิดสเปโต ${c.id}`);
    }
  }
}

// โบนัสตอน "ฝาก" (layoff) — ต่างจากเกิด: หัวเข้าชุดได้(HEAD_MELD), สเปโต = ฝากสเปโต (ไม่ใช่เกิดสเปโต)
function applyLayoffBonuses(s, pid, meld, card) {
  if (card.id === s.headId && !s.headMelded) {
    s.headMelded = true;
    addEvent(s, score.collectFromOthers(pid, s.playerIds, s.config.bonus.headMeld),
      'HEAD_MELD', pid, `เกิดหัว (ฝาก) ${card.id}`);
  }
  if (isSpeto(card)) applySpetoLayoff(s, pid, meld, card);
}

// ฝากสเปโต: เข้าชุดตัวเอง = +3/คนอื่น−1 · เข้าชุดคนอื่น = +3/ผู้เสีย−3 (ผู้เสีย=placedBy ใบที่ไปต่อ)
function applySpetoLayoff(s, layer, meld, card) {
  if (meld.ownerId === layer) {
    addEvent(s, score.collectFromOthers(layer, s.playerIds, s.config.spetoLayoffSelf),
      'SPETO_LAYOFF_SELF', layer, `ฝากสเปโตเข้าชุดตัวเอง ${card.id}`);
  } else {
    const payer = spetoNeighborPlacedBy(meld, card);
    addEvent(s, score.payOne(payer, layer, s.config.spetoLayoffOther),
      'SPETO_LAYOFF_OTHER', layer, `ฝากสเปโต ${card.id} → ผู้เสีย ${payer}`);
  }
}

// หา "ใบที่สเปโตไปต่อ" — เรียง: ไพ่อันดับติดกัน (±1); ตอง: ไม่มีใบก่อนหน้า → เจ้าของชุดเสีย
function spetoNeighborPlacedBy(meld, speto) {
  const ro = RANK_ORDER[speto.rank];
  const neighbor = meld.cards.find(
    (mc) => mc.card.id !== speto.id && Math.abs(RANK_ORDER[mc.card.rank] - ro) === 1,
  );
  return neighbor ? neighbor.placedBy : meld.ownerId;
}

// โชว์สเปโต: ได้ครบ 2 ใบตอนแจก → โชว์รับโบนัส +6/คนอื่น−2 (โชว์ได้จนกว่าจะเล่นตาแรกของตัวเอง)
export function showSpeto(s, pid) {
  if (s.status !== 'PLAYING') throw new Error('รอบจบแล้ว');
  const ps = s.playerStates[pid];
  if (ps.hasPlayed) throw new Error('โชว์สเปโตได้ก่อนเล่นตาแรกของตัวเองเท่านั้น');
  if (ps.shownSpeto) throw new Error('โชว์สเปโตไปแล้ว');
  const hand = s.hands[pid];
  if (!SPETO_IDS.every((id) => hand.some((c) => c.id === id))) {
    throw new Error('ต้องมีสเปโตครบ 2 ใบ (2♣ + Q♠) ตอนแจก');
  }
  ps.shownSpeto = true;
  addEvent(s, score.collectFromOthers(pid, s.playerIds, s.config.bonus.showSpeto),
    'SHOW_SPETO', pid, 'โชว์สเปโตครบ 2 ใบ');
  return s;
}

export function meld(s, pid, cardIds) {
  requireTurn(s, pid);
  requirePhase(s, 'ACTION');
  const cards = cardIds.map((id) => s.hands[pid].find((c) => c.id === id));
  if (cards.some((c) => !c)) throw new Error('ไม่มีไพ่บางใบในมือ');
  if (!isValidMeld(cards)) throw new Error('ชุดไพ่ไม่ถูกกติกา (ต้องเป็นตอง/เรียง)');
  if (s.hands[pid].length - cardIds.length < 1) {
    throw new Error('ต้องเหลือใบปิดอย่างน้อย 1 ใบ — ถ้าจะลงหมดให้น็อค');
  }
  takeFromHand(s, pid, cardIds);
  const m = placeMeld(s, pid, cards);
  applyMeldBonuses(s, pid, cards); // หัวอยู่ในกองทิ้งเสมอ → ไม่เกิดหัวจากมือ แต่เกิดสเปโตได้
  return m;
}

export function layoff(s, pid, cardId, meldId) {
  requireTurn(s, pid);
  requirePhase(s, 'ACTION');
  if (!s.playerStates[pid].hasMelded) throw new Error('ต้องเกิดของตัวเองก่อนถึงจะฝากได้');
  const m = s.melds.find((x) => x.id === meldId);
  if (!m) throw new Error('ไม่พบชุดที่จะฝาก');
  const card = s.hands[pid].find((c) => c.id === cardId);
  if (!card) throw new Error(`ไม่มีไพ่ ${cardId} ในมือ`);
  if (!canLayOff(card, m.cards.map((mc) => mc.card))) throw new Error('ฝากเข้าชุดนี้ไม่ได้');
  if (s.hands[pid].length <= 1) {
    throw new Error('ต้องเหลือใบปิดอย่างน้อย 1 ใบ — ถ้าจะลงหมดให้น็อค');
  }
  takeFromHand(s, pid, [cardId]);
  m.cards.push({ card, placedBy: pid });
  applyLayoffBonuses(s, pid, m, card); // เกิดหัว(ฝาก)/ฝากสเปโต
  return s;
}

// ---------- จบตา: ทิ้ง / น็อค ----------

// ทิ้งเต็ม: มีชุดสมบูรณ์ "ขุดได้" จากกองทิ้ง = suffix บนสุด ≥3 ใบเป็นตอง/เรียง
// (ขุดต้องหยิบต่อเนื่องจากเป้าหมายถึงใบบนสุด → ชุดต้องเป็นใบบนสุดติดกัน)
function detectTingFull(discard) {
  for (let k = 3; k <= discard.length; k++) {
    if (isValidMeld(discard.slice(-k))) return true;
  }
  return false;
}

// โทษการทิ้ง (คิดทันทีจากข้อมูลสาธารณะ) — ทิ้งดัมมี่ + ทิ้งเต็ม ซ้อนกันได้
function applyDiscardPenalties(s, pid, card) {
  // ทิ้งดัมมี่: ใบที่ทิ้งฝากเข้าชุดบนโต๊ะได้
  const dummy = s.melds.some((m) => canLayOff(card, m.cards.map((mc) => mc.card)));
  if (dummy) {
    addEvent(s, score.payToOthers(pid, s.playerIds, s.config.tingPenalty),
      'TING_DUMMY', pid, `ทิ้งดัมมี่ ${card.id}`);
  }
  // ทิ้งเต็ม: ใบที่ทิ้ง + กองทิ้ง เป็นชุดสมบูรณ์ที่ขุดได้
  if (detectTingFull(s.discard)) {
    addEvent(s, score.payToOthers(pid, s.playerIds, s.config.tingPenalty),
      'TING_FULL', pid, `ทิ้งเต็ม ${card.id}`);
  }
}

export function discard(s, pid, cardId) {
  requireTurn(s, pid);
  requirePhase(s, 'ACTION');
  if (s.hands[pid].length <= 1) {
    throw new Error('เหลือไพ่ใบเดียว — ต้องน็อค (ทิ้งใบสุดท้ายไม่ได้)');
  }
  const [card] = takeFromHand(s, pid, [cardId]);
  s.discard.push(card);
  s.discardInfo[card.id] = { by: pid, turnNo: s.turnNo }; // ใครทิ้ง/ตาไหน (ปี้/โง่)
  applyDiscardPenalties(s, pid, card); // ทิ้งดัมมี่/ทิ้งเต็ม (คิดทันที)
  if (s.lastTurn) { endRoundStockOut(s); return s; } // ทิ้งในตาสุดท้าย = ไม่น็อค → จบรอบ
  advanceTurn(s);
  if (s.stock.length === 0) s.lastTurn = true; // กองจั่วหมดแล้ว → คนถัดไปเล่นตาสุดท้าย
  return s;
}

function detectKnockType(s, knocker) {
  const dark = s.playerStates[knocker].firstMeldTurn === s.turnNo; // เกิดครั้งแรกตานี้ = น็อคมืด
  const laid = cardsPlacedBy(s, knocker);
  const color = laid.length > 0 && laid.every((c) => c.suit === laid[0].suit);
  if (dark && color) return 'darkColor';
  if (dark) return 'dark';
  if (color) return 'color';
  return 'normal';
}

export function knock(s, pid, faceDownCardId, rng = Math.random) {
  requireTurn(s, pid);
  requirePhase(s, 'ACTION');
  const hand = s.hands[pid];
  if (hand.length !== 1) throw new Error('น็อคได้เมื่อเหลือไพ่ใบเดียว (ใบปิด)');
  if (hand[0].id !== faceDownCardId) throw new Error('ใบปิดไม่ตรง');

  const knockType = detectKnockType(s, pid);
  const faceDown = hand[0];
  s.winnerId = pid;

  // โง่: คนน็อค "เก็บกองทิ้งสด" ตานี้ → คนทิ้งใบนั้นจ่ายแทนทั้งวง + วนทิศ
  const ngoh = s.foolPickup && s.foolPickup.knocker === pid && s.foolPickup.turnNo === s.turnNo;
  if (ngoh) {
    const isDark = knockType === 'dark' || knockType === 'darkColor';
    // โง่มืดจนชนมืด = น็อคมืดตั้งแต่ต้นรอบ (รอบแรกของตา) → ×4
    const chonMued = isDark && s.turnNo <= s.playerIds.length;
    const mult = chonMued ? 4 : null; // null = ใช้ตัวคูณตาม knockType
    const label = chonMued ? 'โง่มืดจนชนมืด' : isDark ? 'โง่มืด' : 'โง่';
    addEvent(s, objToDeltas(score.placementNgoh(pid, s.foolPickup.fool, knockType, s.config, mult)),
      'KNOCK_NGOH', pid, `${label} (${knockType})`);
    s.direction *= -1; // วนทิศเมื่อโง่
  } else {
    // ผลแพ้ชนะปกติ — ผู้แพ้ = อีก 3 คน
    const losers = s.playerIds.filter((id) => id !== pid).map((id) => ({
      id,
      net: score.playerNet({ melded: cardsPlacedBy(s, id), hand: s.hands[id] }, s.headId),
      forcedBig: !s.playerStates[id].hasMelded, // มืด = ไม่เกิดเลย → เสียมาก
    }));
    addEvent(s, objToDeltas(score.placementNormal(pid, losers, knockType, s.config, rng)),
      'KNOCK', pid, `น็อค (${knockType})`);
  }

  // โบนัสใบปิด: ฝากได้ หรือ เป็นสเปโต
  const layable = s.melds.some((m) => canLayOff(faceDown, m.cards.map((mc) => mc.card)));
  if (layable || isSpeto(faceDown)) {
    addEvent(s, score.collectFromOthers(pid, s.playerIds, s.config.bonus.closeCard),
      'CLOSE_CARD', pid, `ใบปิดพิเศษ ${faceDown.id}`);
  }

  // อมสเปโต: ผู้แพ้ถือสเปโตไม่ลง
  applyAmSpeto(s, pid);

  s.status = 'ENDED';
  return s;
}

// กองจั่วหมด ไม่มีคนน็อค → คนแต้มสุทธิสูงสุดชนะ (ไล่อันดับเหมือนน็อคปกติ ×1)
// แต้มเท่ากัน → สุ่มตัดสิน (เฉพาะคู่ที่เท่า) · อมสเปโต: ทุกคนที่ถือ รวมผู้ชนะ (ไม่ได้เกิด=เสียอม)
function endRoundStockOut(s, rng = Math.random) {
  const ranked = s.playerIds.map((id) => ({
    id,
    net: score.playerNet({ melded: cardsPlacedBy(s, id), hand: s.hands[id] }, s.headId),
    forcedBig: !s.playerStates[id].hasMelded,
  })).sort((a, b) => b.net - a.net || (rng() < 0.5 ? -1 : 1)); // เท่ากัน → สุ่ม
  const winner = ranked[0].id;
  s.winnerId = winner;
  const losers = ranked.slice(1);
  addEvent(s, objToDeltas(score.placementNormal(winner, losers, 'normal', s.config, rng)),
    'STOCK_OUT', winner, 'กองจั่วหมด แต้มสูงสุดชนะ');
  applyAmSpeto(s, null); // กองหมด: ไม่ยกเว้นใคร — ผู้ชนะถือสเปโตไม่เกิดก็เสียอม
  s.status = 'ENDED';
}

// อมสเปโต — ทุกคน(ยกเว้น exemptId ถ้ามี)ที่ถือสเปโตในมือ → ผู้อมจ่ายคนอื่นคนละ 1 ต่อ 1 ใบ
// น็อค: exempt ผู้น็อค (ใบปิดสเปโตคิด CLOSE_CARD แล้ว) · กองหมด: exempt=null (ไม่ยกเว้น)
function applyAmSpeto(s, exemptId) {
  for (const id of s.playerIds) {
    if (id === exemptId) continue;
    for (const c of s.hands[id]) {
      if (isSpeto(c)) {
        addEvent(s, score.payToOthers(id, s.playerIds, s.config.amSpeto),
          'AM_SPETO', id, `อมสเปโต ${c.id}`);
      }
    }
  }
}

// ---------- allowedActions ----------
export function allowedActions(s, pid) {
  if (s.status !== 'PLAYING') return [];
  const acts = [];
  // โชว์สเปโต: ผู้เล่นใดก็ได้ ก่อนเล่นตาแรกของตัวเอง ถ้ามีสเปโตครบ 2 ใบ และยังไม่โชว์
  const ps = s.playerStates[pid];
  if (!ps.hasPlayed && !ps.shownSpeto
      && SPETO_IDS.every((id) => s.hands[pid].some((c) => c.id === id))) {
    acts.push('SHOW_SPETO');
  }
  if (currentPlayer(s) !== pid) return acts;
  if (s.phase === 'DRAW') {
    // ตาสุดท้าย (กองหมด): จั่วไม่ได้ — เก็บกองแล้วน็อค หรือผ่าน
    if (s.lastTurn) return [...acts, 'PICK_DISCARD', 'PASS'];
    return [...acts, 'DRAW_STOCK', 'PICK_DISCARD'];
  }
  acts.push('MELD', 'LAYOFF', 'DISCARD'); // ในตาสุดท้าย: DISCARD = ไม่น็อค → จบรอบ
  if (s.hands[pid].length === 1) acts.push('KNOCK');
  return acts;
}

// เจ้ามือรอบถัดไป — หมุนตามทิศปัจจุบัน (โง่ทำให้วนกลับด้านได้)
export function nextDealerSeat(s) {
  const n = s.playerIds.length;
  return (((s.dealerSeat + s.direction) % n) + n) % n;
}
