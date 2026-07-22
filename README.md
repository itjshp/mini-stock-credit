# Khaikhong v2.3.10

เวอร์ชันนี้แก้ให้ระบบ Reset PIN ผ่าน `?resetPin=1` ทำงานจริงตอนเปิดแอป

## สาเหตุของปัญหา

ใน v2.3.9 มีฟังก์ชัน Reset PIN แล้ว แต่ยังไม่ได้เรียกใช้ตอน Init แอปจริง ทำให้ URL `?resetPin=1` ไม่ทำงานและยังค้างที่หน้าล็อก

## สิ่งที่แก้

1. เรียก `maybeAutoLockOnStart()` หลังโหลดข้อมูลเสร็จ
2. เพิ่ม Boot Safety อีกรอบหลังหน้าเว็บโหลด เพื่อกัน cache/service worker timing
3. รองรับรูปแบบ Reset เพิ่มเติม:
   - `?resetPin=1`
   - `?resetPin=true`
   - `?resetpin=1`
   - `#resetPin`
4. ปุ่ม ลืม PIN ใช้ confirm ชั้นเดียว แล้ว Reset เฉพาะ PIN ทันที
5. เพิ่ม Console rescue:
   - เปิด DevTools Console แล้วพิมพ์ `forceResetKhaikhongPin()`

## วิธีแก้กรณีติด PIN อยู่ตอนนี้

1. อัปโหลด v2.3.10 ทับไฟล์เดิมใน GitHub
2. Commit changes
3. รอ GitHub Pages deploy 1-3 นาที
4. เปิด URL จริงของโปรเจกต์ เช่น:

   `https://itjshp.github.io/mini-stock-credit/?resetPin=1`

5. กด Enter
6. ถ้ายังไม่หาย ให้กด Ctrl+F5 หรือปิด/เปิด PWA ใหม่

## หมายเหตุ

ห้ามใช้ `/xxxx/` เพราะเป็นแค่ตัวอย่าง จะขึ้น 404
ต้องใช้ path จริงของโปรเจกต์ เช่น `/mini-stock-credit/`
