# Khaikhong v2.3.11

เวอร์ชันนี้เพิ่มหน้า Rescue สำหรับแก้ PIN Lock และ Cache เก่า

## ปัญหาที่แก้

ถ้า Browser ยังโหลดไฟล์เก่าจาก Service Worker/Cache:
- `?resetPin=1` อาจไม่ทำงาน
- หน้าล็อก PIN อาจยังขึ้นเหมือนเดิม
- ปุ่มลืม PIN อาจใช้โค้ดเก่า

## วิธีแก้ใหม่

หลังอัปโหลด v2.3.11 แล้ว ให้เปิด URL นี้โดยตรง:

`https://itjshp.github.io/mini-stock-credit/reset-pin.html`

หน้านี้จะทำงานแยกจาก app.js และจะ:
1. ปิด PIN ใน IndexedDB
2. ตั้งค่า session ว่าปลดล็อกแล้ว
3. ล้าง Cache Storage
4. Unregister Service Worker
5. กลับเข้าแอปให้อัตโนมัติ

## ถ้า reset-pin.html ยังไม่เข้า

ลอง URL สำรอง:

`https://itjshp.github.io/mini-stock-credit/clear-cache.html`

## วิธีอัปเดต

1. แตกไฟล์ zip
2. อัปโหลดไฟล์ทั้งหมดทับของเดิม รวมถึง `reset-pin.html` และ `clear-cache.html`
3. Commit changes
4. รอ GitHub Pages deploy 1-3 นาที
5. เปิด `reset-pin.html`
6. หลังระบบพากลับเข้าแอป ให้กด Ctrl+F5 อีกครั้ง

## หมายเหตุ

ข้อมูลสินค้า/ลูกค้า/บิลไม่ถูกลบ หน้านี้ Reset เฉพาะ PIN และ Cache เท่านั้น
