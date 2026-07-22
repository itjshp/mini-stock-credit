# Khaikhong v2.3.13

เวอร์ชันนี้ถอด PIN Lock ออกจาก runtime แบบ hard remove เพื่อแก้กรณีติดหน้าล็อก

## สิ่งที่ทำ

1. ลบ PIN Lock overlay ออกจาก index.html
2. Override ฟังก์ชัน PIN ทั้งหมดไม่ให้ล็อกแอป
3. พักการ register Service Worker ชั่วคราว
4. sw.js ใหม่จะล้าง cache แล้ว unregister ตัวเอง
5. reset-pin.html ตรวจหลายชื่อ IndexedDB และปิด PIN ใน settings
6. เพิ่ม no-sw.html สำหรับเข้าแอปแบบไม่ผ่าน Service Worker

## วิธีแก้เครื่องที่ยังเด้งเข้า Lock

หลังอัปโหลด v2.3.13 แล้ว ให้เปิดตามลำดับนี้:

1. `https://itjshp.github.io/mini-stock-credit/reset-pin.html`
2. รอให้เด้งไป `no-sw.html`
3. รอให้เด้งเข้าแอป
4. กด Ctrl+F5 อีกครั้ง

ถ้ายังไม่หาย ให้เปิด:
`https://itjshp.github.io/mini-stock-credit/no-sw.html`

## ทางสุดท้ายใน Chrome

1. กด F12
2. ไปแท็บ Application
3. กด Storage
4. กด Clear site data
5. เปิดเว็บใหม่

หมายเหตุ: Clear site data อาจลบข้อมูลในเครื่อง ถ้ายังไม่ได้ Backup ให้ใช้ reset-pin.html ก่อน
