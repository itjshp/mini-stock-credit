# Mini Stock Credit PWA

เวอร์ชัน v0.4 — Modern Clean POS UI

ฟีเจอร์หลัก:
- UI แนว Modern Clean POS
- หน้า Dashboard ใหม่
- หน้า "ขาย POS" พร้อมค้นหาสินค้าและปุ่มเลือกสินค้าเร็ว
- เพิ่ม/แก้ไข/ลบสินค้า ลูกค้า ซื้อเข้า ขาย รับชำระ
- คำนวณสต็อก ต้นทุนเฉลี่ย กำไร และลูกหนี้ใหม่อัตโนมัติ
- Backup / Restore เป็น JSON
- Export รายงานขายเป็น CSV

## วิธีอัปเดต GitHub Pages

1. แตกไฟล์ zip
2. อัปโหลดไฟล์ทั้งหมดทับของเดิมใน GitHub Repository
3. Commit changes
4. รอ GitHub Pages deploy 1-3 นาที
5. เปิดเว็บแล้วกด Ctrl+F5 หรือปิด/เปิด PWA ใหม่ เพราะมี cache

## หมายเหตุสำคัญ

ข้อมูลจริงเก็บใน Browser/เครื่องที่ใช้งานด้วย IndexedDB ไม่ได้เก็บบน GitHub
ควร Export Backup เป็นประจำ
