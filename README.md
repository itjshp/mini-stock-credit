# Mini Stock Credit PWA

แอปตัวอย่างสำหรับใช้แทน Google Sheet:
- เพิ่ม/แก้ไขสินค้า
- เพิ่ม/แก้ไขลูกค้า
- ซื้อสินค้าเข้า
- ขายเงินสด / ขายเครดิต
- รับชำระลูกหนี้
- Dashboard สรุปยอดขาย กำไร ลูกหนี้ มูลค่าสต็อก
- Backup / Restore เป็น JSON
- Export รายงานขายเป็น CSV

## วิธีทดสอบบนเครื่องแบบง่าย

1. แตกไฟล์ zip
2. เปิดโฟลเดอร์ `mini-stock-credit-pwa`
3. ถ้ามี Python ให้รันคำสั่ง:

```bash
python -m http.server 8080
```

4. เปิด Browser ไปที่:

```text
http://localhost:8080
```

## วิธีเอาขึ้น GitHub Pages

1. สร้าง GitHub Repository ใหม่ เช่น `mini-stock-credit`
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้เข้า repository
3. ไปที่ Settings > Pages
4. Source เลือก Deploy from a branch
5. Branch เลือก `main` และ `/root`
6. กด Save
7. รอ GitHub สร้าง URL เช่น:

```text
https://USERNAME.github.io/mini-stock-credit/
```

## หมายเหตุสำคัญ

ข้อมูลจริงเก็บใน Browser/เครื่องที่ใช้งานด้วย IndexedDB ไม่ได้เก็บบน GitHub
ควร Export Backup เป็นประจำ โดยเฉพาะก่อนล้างเครื่อง เปลี่ยนมือถือ หรือล้าง Browser
