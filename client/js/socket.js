// socket.js — เชื่อม Socket.IO + helper ส่ง event (callback → promise) + เก็บ session ไว้ reconnect
/* global io */
const Net = (() => {
  const socket = io({ transports: ['websocket', 'polling'] });
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
