# 🚀 วิธี Deploy ฟรีบน Render (เล่นกับเพื่อนผ่านเน็ตจริง)

> เป้าหมาย: เอาเกมขึ้นเน็ตฟรี $0 **ไม่ต้องใช้บัตรเครดิต** → ได้ลิงก์ `https://xxx.onrender.com` ส่งให้เพื่อน 4 คนเล่น
> โปรเจกต์เตรียมพร้อม deploy ไว้แล้ว (อ่าน PORT จาก env, listen 0.0.0.0, มี package-lock, engines Node ≥20)
> Socket.IO ใช้ long-polling/websocket อัตโนมัติ → ทำงานได้แม้ free tier ไม่เปิด websocket native

> 📌 *เดิมวางแผนใช้ Koyeb แต่ Koyeb เลิก free tier แล้ว → เปลี่ยนมาใช้ Render (ฟรี ไม่ใช้บัตร)*

---

## ขั้น 1 — push โค้ดขึ้น GitHub

1. สร้างบัญชี [github.com](https://github.com) (ฟรี) ถ้ายังไม่มี
2. สร้าง repo ใหม่ (ปุ่ม **New**) → ชื่อเช่น `dummy-thai` → Private ก็ได้ → **อย่าติ๊ก Add README** → Create
3. ในเครื่อง เปิด **Terminal** ที่โฟลเดอร์โปรเจกต์นี้ แล้ว push (remote ตั้งไว้ให้แล้ว):

```bash
git push -u origin main
```
> ถ้า GitHub ขอ login: สร้าง **Personal Access Token** (Settings → Developer settings → Tokens (classic) → scope `repo`) แล้ว push ด้วย
> `git push https://<USERNAME>:<TOKEN>@github.com/<USERNAME>/dummy-thai.git main`

---

## ขั้น 2 — สร้าง Web Service บน Render

1. ไป [render.com](https://render.com) → **Get Started / Sign up ด้วย GitHub** (ฟรี **ไม่ต้องใช้บัตร**)
2. กด **New +** → **Web Service** → เลือก repo `dummy-thai` (กด Connect/Configure ให้ Render เห็น repo)
3. ตั้งค่า:
   - **Name:** `dummy-thai` (จะกลายเป็น URL: `dummy-thai.onrender.com`)
   - **Region:** Singapore (ใกล้ไทยสุด)
   - **Branch:** `main`
   - **Runtime:** `Node` (ตรวจเจอเอง)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free** ⬅️ สำคัญ
4. กด **Create Web Service** → รอ build ~2-4 นาที → ได้ลิงก์ `https://dummy-thai.onrender.com`

> ไม่ต้องตั้ง env เพิ่ม — Render ใส่ตัวแปร `PORT` ให้เอง โค้ดเราอ่านค่านี้อยู่แล้ว

---

## ขั้น 3 — เล่นกับเพื่อน

1. เปิดลิงก์ `https://dummy-thai.onrender.com` บนมือถือ/คอม (**ถือมือถือแนวนอน**)
2. ใส่ชื่อ → **สร้างห้องใหม่** → ได้รหัสห้อง 4 ตัว
3. ส่งลิงก์ + รหัสให้เพื่อน 3 คน → เพื่อนใส่รหัส → **เข้าห้อง**
4. ครบ 4 คน → host กด **เริ่มเกม**
5. หลุดเน็ต/รีเฟรช → เปิดลิงก์เดิม กลับเข้าเกมเดิมอัตโนมัติ

---

## ⚠️ ข้อจำกัดของฟรี (ยอมรับได้สำหรับเล่นกับเพื่อน)

- **เซิร์ฟเวอร์หลับเมื่อไม่มีคนเล่น ~15 นาที** → เปิดลิงก์ครั้งแรกรอ ~30–60 วิ (cold start) แล้วจะลื่นปกติ
- ฟรี ~750 ชั่วโมง/เดือน (พอสำหรับ 1 service เล่นกับเพื่อน)
- **เซิร์ฟเวอร์รีสตาร์ท/หลับ = เกมที่ค้างอยู่หาย** (state อยู่ใน RAM) → แก้ใน **M7** (เซฟลง DB ฟรี + reconnect โหลดกลับ)

## 🔄 อัปเดตเกม (หลังแก้โค้ด)

```bash
git add -A && git commit -m "อัปเดต..." && git push
```
Render จะ **auto-deploy** ใหม่ให้เองทุกครั้งที่ push

---

## 🆘 ถ้า build ไม่ผ่าน / ติดปัญหา

- ดู log ใน Render (แท็บ **Logs** ของ service)
- ตัวสำรองฟรีอื่นที่รองรับ websocket + ไม่ใช้บัตร: **Fly.io** (ต้องใช้บัตร), **SnapDeploy**, **Bonto** — *free tier เปลี่ยนบ่อย เช็คเงื่อนไขล่าสุดตอน deploy*
