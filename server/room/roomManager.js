// roomManager — จัดการห้อง/ผู้เล่น/รอบ (logic ล้วน ไม่พึ่ง socket — เทสได้)
// อ้างอิง: docs/02-ออกแบบ-data-model.md §10, §14.1-14.5 · docs/03-โครงสร้างโปรเจกต์.md
//
// แยกชัด: ที่นี่คือ "สถานะห้อง + dispatch action + สรุปคะแนน" — ส่วน socket/timer อยู่ที่ socket/handlers.js

import {
  startRound, nextDealerSeat,
  drawStock, pickDiscard, meld, layoff, discard, knock, showSpeto, passTurn,
  totals,
} from '../game/round.js';
import { DEFAULT_CONFIG, toMoney } from '../game/scoring.js';
import { getPlayerView } from '../game/playerView.js';

export const MAX_PLAYERS = 4;

// ตั้งค่าห้อง (นอกเหนือคะแนน) — เวลา/เวลา grace หลุด
export const DEFAULT_SETTINGS = Object.freeze({
  graceSeconds: 60,   // เวลารอคนหลุดกลับมา ก่อนเด้ง popup ให้ host เลือก
  turnSeconds: 0,     // 0 = ไม่จับเวลาต่อตา (M7 ค่อยเปิด)
});

// ---------- ตัวสร้างรหัส/โทเคน (inject ได้เพื่อเทส) ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // เลี่ยง 0/O/1/I
function randomCode(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}
function randomToken() {
  let out = '';
  for (let i = 0; i < 24; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

// ---------- สร้าง/เข้า/ออกห้อง ----------
export function createRoom({
  hostName, config = DEFAULT_CONFIG, moneyRate, settings = DEFAULT_SETTINGS,
  genCode = randomCode, genToken = randomToken,
} = {}) {
  // เรทเงิน (บาท/คะแนน) ที่ host เลือก → override moneyRate ใน config
  const rate = Number(moneyRate) > 0 ? Number(moneyRate) : config.moneyRate;
  const room = {
    code: genCode(),
    hostId: null,
    players: [],          // เรียงตาม seat
    config: { ...config, moneyRate: rate },
    settings,
    status: 'WAITING',    // WAITING / PLAYING / FINISHED
    round: null,
    awaitingNextRound: false,
    lastSummary: null,
    dealerSeat: 0,        // เจ้ามือรอบถัดไป (หมุนข้ามรอบ)
    direction: 1,         // ทิศปัจจุบัน (โง่ทำให้วนกลับ — ส่งต่อข้ามรอบ)
    seq: 0,               // ตัวนับสร้าง id (id เสถียร ไม่จัดใหม่ตอนมีคนออก)
    genToken,
  };
  const host = joinRoom(room, { name: hostName });
  room.hostId = host.id;
  return room;
}

// เข้าห้อง (เฉพาะตอน WAITING, ไม่เกิน 4 คน) → คืน player (มี token)
export function joinRoom(room, { name } = {}) {
  if (room.status !== 'WAITING') throw new Error('เกมเริ่มแล้ว เข้าห้องไม่ได้');
  if (room.players.length >= MAX_PLAYERS) throw new Error('ห้องเต็มแล้ว (4 คน)');
  const seat = room.players.length;
  room.seq += 1;
  const player = {
    id: `p${room.seq}`,   // id เสถียร (ไม่เปลี่ยนแม้มีคนออก) → seat ใช้จัดลำดับแสดงผลแทน
    name: name || `ผู้เล่น ${seat + 1}`,
    seat,
    token: room.genToken(),
    connected: true,
    disconnectedAt: null,
    totalScore: 0,        // คะแนนสะสมข้ามรอบ
  };
  room.players.push(player);
  return player;
}

// ออกจากห้อง (เฉพาะ WAITING/FINISHED — กลางเกมห้าม) → ลบ + เรียง seat ใหม่ (id คงเดิม) · host ออก → ย้าย host
export function leaveRoom(room, playerId) {
  if (room.status === 'PLAYING') throw new Error('ระหว่างเล่นออกไม่ได้ (ใช้หลุด/จบแมตช์แทน)');
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx < 0) throw new Error('ไม่พบผู้เล่นในห้อง');
  room.players.splice(idx, 1);
  room.players.forEach((p, i) => { p.seat = i; }); // เรียง seat ใหม่ (id เสถียร ไม่แตะ)
  if (room.players.length === 0) { room.status = 'FINISHED'; return room; }
  if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players[0].id;
  return room;
}

// ---------- หลุด & กลับเข้าเกม (reconnect) ----------
export function markDisconnected(room, playerId, now = Date.now()) {
  const p = playerById(room, playerId);
  if (!p) return null;
  p.connected = false;
  p.disconnectedAt = now;
  return p;
}

// กลับเข้าเกมด้วย token → ผูกที่นั่งเดิม (id เดิม)
export function rejoinByToken(room, token) {
  const p = room.players.find((x) => x.token === token);
  if (!p) throw new Error('โทเคนไม่ถูกต้อง — กลับเข้าห้องไม่ได้');
  p.connected = true;
  p.disconnectedAt = null;
  return p;
}

// เกิน grace แล้วยังไม่กลับ? (ให้ socket layer ตัดสินใจเด้ง popup host)
export function isGraceExpired(room, playerId, now = Date.now()) {
  const p = playerById(room, playerId);
  if (!p || p.connected || p.disconnectedAt == null) return false;
  return now - p.disconnectedAt >= room.settings.graceSeconds * 1000;
}

// ---------- เริ่มเกม / รอบ ----------
export function startGame(room, { deck, rng } = {}) {
  if (room.status !== 'WAITING') throw new Error('เริ่มเกมได้เฉพาะตอนรอผู้เล่น');
  if (room.players.length !== MAX_PLAYERS) throw new Error('ต้องมีผู้เล่นครบ 4 คนก่อนเริ่ม');
  if (room.players.some((p) => !p.connected)) throw new Error('มีผู้เล่นหลุดอยู่ — รอให้กลับมาก่อนเริ่ม');
  room.status = 'PLAYING';
  room.dealerSeat = 0;
  room.direction = 1;
  startNewRound(room, { deck, rng });
  return room;
}

// host เริ่มรอบใหม่หลังจบรอบ — หมุนเจ้ามือ + ส่งทิศต่อ
export function startNextRound(room, { deck, rng } = {}) {
  if (room.status !== 'PLAYING' || !room.awaitingNextRound) {
    throw new Error('ยังไม่ถึงเวลาเริ่มรอบใหม่');
  }
  startNewRound(room, { deck, rng });
  return room;
}

function startNewRound(room, { deck } = {}) {
  room.round = startRound({
    playerIds: room.players.map((p) => p.id),
    dealerSeat: room.dealerSeat,
    direction: room.direction,
    config: room.config,
    deck,
  });
  room.awaitingNextRound = false;
  return room;
}

// ---------- ดำเนิน action ----------
const DISPATCH = {
  SHOW_SPETO: (s, pid) => showSpeto(s, pid),
  DRAW_STOCK: (s, pid) => drawStock(s, pid),
  PICK_DISCARD: (s, pid, p) => pickDiscard(s, pid, p.targetIndex, p.plan ?? {}),
  MELD: (s, pid, p) => meld(s, pid, p.cardIds),
  LAYOFF: (s, pid, p) => layoff(s, pid, p.cardId, p.meldId),
  DISCARD: (s, pid, p) => discard(s, pid, p.cardId),
  KNOCK: (s, pid, p) => knock(s, pid, p.faceDownCardId),
  PASS: (s, pid) => passTurn(s, pid),
};

// รับ action จากผู้เล่น → เรียก engine → ถ้ารอบจบ สรุป+สะสมคะแนน
export function applyAction(room, playerId, action, payload = {}) {
  if (room.status !== 'PLAYING' || !room.round) throw new Error('ยังไม่ได้เริ่มเกม');
  if (!playerById(room, playerId)) throw new Error('ไม่พบผู้เล่นในห้อง');
  const fn = DISPATCH[action];
  if (!fn) throw new Error(`action ไม่รู้จัก: ${action}`);
  fn(room.round, playerId, payload);
  if (room.round.status === 'ENDED') finalizeRound(room);
  return room;
}

// รอบจบ → บวกคะแนนสะสม + สร้าง summary + หมุนเจ้ามือ/ทิศสำหรับรอบหน้า
function finalizeRound(room) {
  const r = room.round;
  const roundTotals = totals(r);
  for (const p of room.players) {
    p.totalScore += roundTotals[p.id] ?? 0;
  }
  room.lastSummary = buildSummary(room, roundTotals);
  room.awaitingNextRound = true;
  // เตรียมรอบหน้า: เจ้ามือถัดไป + ส่งทิศต่อ (วนทิศจากโง่คงอยู่จนกว่าจะโง่อีก)
  room.dealerSeat = nextDealerSeat(r);
  room.direction = r.direction;
}

// สรุปรอบ (RoundSummary §14.3): ต่อคน roundScore/breakdown/totalScore/money
function buildSummary(room, roundTotals) {
  const rows = room.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    roundScore: roundTotals[p.id] ?? 0,
    totalScore: p.totalScore,
    money: toMoney(p.totalScore, room.config.moneyRate),
    breakdown: room.round.events
      .map((e) => ({ type: e.type, note: e.note, by: e.by, amount: deltaFor(e, p.id) }))
      .filter((x) => x.amount !== 0),
  }));
  return {
    winnerId: room.round.winnerId,
    headId: room.round.headId,
    rows,
  };
}

function deltaFor(event, pid) {
  const d = event.deltas;
  if (Array.isArray(d)) return d.filter((x) => x.id === pid).reduce((a, x) => a + x.amount, 0);
  return d[pid] ?? 0;
}

// ---------- ปิดห้อง (จบแมตช์) ----------
export function closeRoom(room) {
  room.status = 'FINISHED';
  room.finalSummary = room.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    totalScore: p.totalScore,
    money: toMoney(p.totalScore, room.config.moneyRate),
  }));
  return room;
}

// เริ่มแมตช์ใหม่หลังจบแมตช์ (host) → รีเซ็ตคะแนนสะสม กลับห้องรอ (คงผู้เล่น+เรทเงินเดิม)
export function newMatch(room) {
  if (room.status !== 'FINISHED') throw new Error('เริ่มแมตช์ใหม่ได้เฉพาะตอนจบแมตช์แล้ว');
  room.players.forEach((p) => { p.totalScore = 0; });
  room.status = 'WAITING';
  room.round = null;
  room.awaitingNextRound = false;
  room.lastSummary = null;
  room.finalSummary = null;
  room.dealerSeat = 0;
  room.direction = 1;
  return room;
}

// ---------- views (ส่งให้ client) ----------
// view สำหรับผู้เล่นคนหนึ่ง — รวมข้อมูลห้อง + (ถ้ากำลังเล่น) มุมมองรอบของเขา
export function getRoomView(room, playerId) {
  const base = {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    you: playerId,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat,
      connected: p.connected, totalScore: p.totalScore,
    })),
    settings: room.settings,
    moneyRate: room.config.moneyRate,
    awaitingNextRound: room.awaitingNextRound,
    lastSummary: room.lastSummary,
  };
  if (room.status === 'PLAYING' && room.round) {
    base.round = getPlayerView(room.round, playerId);
  }
  if (room.status === 'FINISHED') base.finalSummary = room.finalSummary;
  return base;
}

// ---------- helpers ----------
export function playerById(room, playerId) {
  return room.players.find((p) => p.id === playerId) ?? null;
}
export function playerByToken(room, token) {
  return room.players.find((p) => p.token === token) ?? null;
}
