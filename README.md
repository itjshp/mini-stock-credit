# Mini Stock Credit PWA

เวอร์ชัน v0.5 — POS Upgrade + Demo/Pro Foundation

ฟีเจอร์ใหม่:
- POS Number Pad สำหรับช่องตัวเลข
- Color Refresh ให้สีเด่นขึ้น
- หน้า Upgrade / Plan
- สถานะ Demo / Pro
- Demo จำกัดสินค้า 30 รายการ, ลูกค้า 20 ราย, รายการขาย 100 รายการ
- Pro ปลดล็อกด้วยรหัสทดสอบ `PRO2026`
- Export CSV ล็อกไว้เป็นฟีเจอร์ Pro
- ยังคงข้อมูลเดิมใน IndexedDB ไม่ได้เก็บบน GitHub

## วิธีอัปเดต GitHub Pages

1. แตกไฟล์ zip
2. อัปโหลดไฟล์ทั้งหมดทับของเดิมใน GitHub Repository
3. Commit changes
4. รอ GitHub Pages deploy 1-3 นาที
5. เปิดเว็บแล้วกด Ctrl+F5 หรือปิด/เปิด PWA ใหม่ เพราะมี cache

## หมายเหตุสำคัญ

ระบบ Demo/Pro ใน v0.5 เป็นแบบ Local Demo สำหรับทดลองแนวคิดสินค้า ยังไม่ใช่ระบบ License ป้องกันจริงระดับ Production
ถ้าจะขายจริงควรทำ Backend ตรวจสอบ License / Email / Device เพิ่มภายหลัง
