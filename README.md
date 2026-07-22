# Khaikhong v2.3.12

เวอร์ชันนี้พักระบบ PIN Lock ชั่วคราว และเพิ่ม Privacy Mode แทน

## เหตุผล

ระบบ PIN Lock ทำให้มีความเสี่ยงติดหน้าล็อกในช่วง Beta จึงปิดการล็อกแอปทั้งหมดก่อน เพื่อให้กลับมาใช้งานระบบขาย/สต็อก/ลูกหนี้ได้เต็มรูปแบบ

## สิ่งที่แก้

1. ปิด PIN Lock แบบบังคับทั้งหมด
   - แอปจะไม่เด้งเข้าหน้า Lock อีก
   - แม้มีค่า PIN ค้าง ระบบจะพยายามปิด PIN ให้อัตโนมัติ

2. ปรับ reset-pin.html
   - ปิด PIN ใน IndexedDB
   - ล้าง Cache Storage
   - Unregister Service Worker
   - กลับเข้าแอปด้วย `pinOff=1`

3. เพิ่ม Privacy Mode
   - อยู่ที่หน้า ความปลอดภัย
   - ใช้ซ่อนยอดเงิน/กำไร/ลูกหนี้แบบเบลอ
   - เหมาะกว่าการล็อกทั้งแอปในช่วง Beta

## วิธีแก้กรณีตอนนี้ติดหน้า PIN

หลังอัปโหลด v2.3.12 แล้ว เปิด:

`https://itjshp.github.io/mini-stock-credit/reset-pin.html`

รอให้ระบบพากลับเข้าแอปเอง

ถ้ายังไม่หาย:
1. เปิด `clear-cache.html`
2. กด Ctrl+F5
3. หรือเปิด DevTools > Application > Clear site data

## วิธีอัปเดต

1. แตก zip
2. อัปโหลดไฟล์ทั้งหมดทับของเดิม รวมถึง reset-pin.html และ clear-cache.html
3. Commit changes
4. รอ Deploy 1-3 นาที
5. เปิด reset-pin.html
