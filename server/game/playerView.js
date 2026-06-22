// PlayerView — ข้อมูลที่ส่งให้ผู้เล่นแต่ละคน (ซ่อนไพ่ลับ กันโกง)
// อ้างอิง: docs/02-ออกแบบ-data-model.md §14.4

import { allowedActions, totals } from './round.js';

// สร้าง view เฉพาะของผู้เล่น pid:
//  - เห็นไพ่ตัวเอง / มือคนอื่นเห็นแค่จำนวน / กองจั่วเห็นแค่จำนวน
//  - กองทิ้ง + ชุดที่เกิด + คะแนน = สาธารณะ
export function getPlayerView(s, pid) {
  const handCounts = {};
  for (const id of s.playerIds) handCounts[id] = s.hands[id].length;

  return {
    you: pid,
    yourHand: s.hands[pid] ?? [],          // ลับ — เฉพาะเจ้าของ
    handCounts,                            // คนอื่นเห็นแค่จำนวนใบ
    stockCount: s.stock.length,            // กองจั่วเห็นแค่จำนวน
    discard: s.discard,                    // สาธารณะ (เห็นทุกใบ)
    headId: s.headId,
    melds: s.melds,                        // สาธารณะ (ชุดที่เกิดของทุกคน)
    playerIds: s.playerIds,
    currentSeat: s.currentSeat,
    direction: s.direction,
    phase: s.phase,
    turnNo: s.turnNo,
    status: s.status,
    winnerId: s.winnerId,
    youMelded: s.playerStates[pid]?.hasMelded ?? false,        // เปิดแล้วหรือยัง (กฎเปิดต้องเก็บกอง)
    openedFromHand: s.playerStates[pid]?.openedFromHand ?? false, // เปิดจากมือ → ต้องน็อคตานี้
    scores: totals(s),                     // คะแนนสะสมรอบนี้ (live standings)
    moneyRate: s.config.moneyRate,
    allowedActions: allowedActions(s, pid),
  };
}
