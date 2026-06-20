// index.js — จุดเริ่มเซิร์ฟเวอร์: HTTP (เสิร์ฟ client) + Socket.IO
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGameServer } from './socket/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = createServer(app);
const io = new Server(server);
createGameServer(io);

// 0.0.0.0 = รับ connection จากทุก interface (จำเป็นบน Koyeb/host ทั่วไป)
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🎴 ดัมมี่ไทย พร้อมเล่น: http://localhost:${PORT}`);
});
