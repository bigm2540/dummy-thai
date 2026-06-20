// socket.js — เชื่อม Socket.IO + helper ส่ง event (callback → promise) + เก็บ session ไว้ reconnect
/* global io */
const Net = (() => {
  // ไม่ระบุ transports → Socket.IO negotiate เอง (polling ก่อน แล้ว upgrade เป็น websocket ถ้าโฮสต์รองรับ)
  // ทำให้ใช้ได้ทุกโฮสต์ รวม free tier ที่ไม่เปิด websocket native (จะใช้ long-polling แทน)
  const socket = io();
  const SKEY = 'dummy.session'; // { code, token }

  // ส่ง event แบบรอผลลัพธ์ (server ตอบ {ok,error,...})
  function emit(event, payload) {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
  }

  function saveSession(code, token) {
    localStorage.setItem(SKEY, JSON.stringify({ code, token }));
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; }
  }
  function clearSession() { localStorage.removeItem(SKEY); }

  return { socket, emit, on: (...a) => socket.on(...a), saveSession, loadSession, clearSession };
})();
