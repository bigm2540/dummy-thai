# 🚀 วิธี Deploy ฟรีบน Koyeb (เล่นกับเพื่อนผ่านเน็ตจริง)

> เป้าหมาย: เอาเกมขึ้นเน็ตฟรี $0 → ได้ลิงก์ `https://xxx.koyeb.app` ส่งให้เพื่อน 4 คนเล่น
> โปรเจกต์เตรียมพร้อม deploy ไว้แล้ว (อ่าน PORT จาก env, listen 0.0.0.0, มี package-lock, engines Node ≥20)

---

## ขั้น 1 — push โค้ดขึ้น GitHub

1. สร้างบัญชี [github.com](https://github.com) (ฟรี) ถ้ายังไม่มี
2. สร้าง repo ใหม่ (ปุ่ม **New** มุมขวาบน) → ตั้งชื่อเช่น `dummy-thai` → **Private ก็ได้** → กด **Create**
   - ⚠️ อย่าติ๊ก "Add README" (เรามีไฟล์อยู่แล้ว)
3. ในเครื่อง เปิด terminal ที่โฟลเดอร์โปรเจกต์นี้ แล้วรัน (แทน `<URL>` ด้วยลิงก์ repo ที่ GitHub ให้):

```bash
git remote add origin <URL>      # เช่น https://github.com/ชื่อคุณ/dummy-thai.git
git branch -M main
git push -u origin main
```

> โค้ดถูก `git commit` ไว้ให้แล้ว — แค่ push ขึ้นไป

---

## ขั้น 2 — สร้าง Web Service บน Koyeb

1. ไป [koyeb.com](https://www.koyeb.com) → **Sign up** ด้วย **GitHub** (ฟรี ไม่ต้องใช้บัตร)
2. กด **Create Web Service** → เลือก **GitHub** → อนุญาตให้ Koyeb เห็น repo → เลือก repo `dummy-thai`
3. ตั้งค่า:
   - **Builder:** `Buildpack` (Koyeb จะตรวจเจอ Node เอง — รัน `npm install` + `npm start`)
   - **Instance:** เลือก **Free** (`nano`/eco — ฟรี)
   - **Region:** Singapore (ใกล้ไทยสุด)
   - **Port:** `8000` *(Koyeb ใส่ตัวแปร `PORT` ให้อัตโนมัติ — โค้ดเราอ่านค่านี้อยู่แล้ว ไม่ต้องตั้ง env เพิ่ม)*
   - **Health check (ถ้ามีให้ตั้ง):** HTTP path `/health`
4. กด **Deploy** → รอ build ~1-3 นาที → ได้ลิงก์ `https://ชื่อ-org.koyeb.app`

> WebSocket (Socket.IO) ใช้ได้เลยบน Koyeb web service ไม่ต้องตั้งอะไรเพิ่ม

---

## ขั้น 3 — เล่นกับเพื่อน

1. เปิดลิงก์ `https://xxx.koyeb.app` บนมือถือ/คอม (**ถือมือถือแนวนอน**)
2. ใส่ชื่อ → **สร้างห้องใหม่** → ได้รหัสห้อง 4 ตัว (เช่น `9WYW`)
3. ส่งลิงก์ + รหัสให้เพื่อน 3 คน → เพื่อนใส่รหัส → **เข้าห้อง**
4. ครบ 4 คน → host กด **เริ่มเกม**
5. หลุดเน็ต/รีเฟรช → เปิดลิงก์เดิม กลับเข้าเกมเดิมอัตโนมัติ (เก็บไว้ใน localStorage)

---

## ⚠️ ข้อจำกัดของฟรี (ยอมรับได้สำหรับเล่นกับเพื่อน)

- **เซิร์ฟเวอร์หลับเมื่อไม่มีคนเล่น** → เปิดลิงก์ครั้งแรกรอ ~30–60 วิ (cold start) แล้วจะลื่นปกติ
- **เซิร์ฟเวอร์รีสตาร์ท/หลับ = เกมที่ค้างอยู่หาย** (state เก็บใน RAM)
  - 👉 แก้ใน **M7**: เซฟลง Postgres ฟรี + โหลดกลับตอน reconnect
  - ตอนนี้: เล่นจบแมตช์ในรวดเดียว ไม่ทิ้งค้างนาน ก็โอเค

## 🔄 อัปเดตเกม (หลังแก้โค้ด)

```bash
git add -A && git commit -m "อัปเดต..." && git push
```
Koyeb จะ **auto-deploy** ใหม่ให้เองทุกครั้งที่ push

---

## 🆘 ถ้า build ไม่ผ่าน / ติดปัญหา

- ดู log ใน Koyeb (แท็บ **Deployments** → **Logs**)
- เช็คว่า Koyeb เลือก Node ≥ 20 (เราใส่ `engines` ไว้แล้ว)
- ตัวสำรองฟรีอื่น: **Render** (+ UptimeRobot กันหลับ), **Fly.io** — *free tier เปลี่ยนบ่อย เช็คเงื่อนไขล่าสุดตอน deploy*
