const DB_NAME = "khaikhong-v2-db";
const DB_VERSION = 1;
const STORES = ["products","customers","bills","bill_items","payments","stock_movements","settings"];

let db;
let state = { products: [], customers: [], bills: [], bill_items: [], payments: [], stock_movements: [], settings: [] };
let cart = [];
let selectedLedgerCustomerId = "";
let selectedBillId = "";
let currentNumberInput = null;
let numberPadValue = "";
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2400);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      STORES.forEach(s => {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function getAll(name) {
  return new Promise((resolve, reject) => {
    const r = store(name).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function put(name, item) {
  return new Promise((resolve, reject) => {
    const r = store(name, "readwrite").put(item);
    r.onsuccess = () => resolve(item);
    r.onerror = () => reject(r.error);
  });
}

function del(name, id) {
  return new Promise((resolve, reject) => {
    const r = store(name, "readwrite").delete(id);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

function clearStore(name) {
  return new Promise((resolve, reject) => {
    const r = store(name, "readwrite").clear();
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}

async function loadState() {
  const rows = await Promise.all(STORES.map(getAll));
  STORES.forEach((s, i) => state[s] = rows[i]);

  state.products.sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
  state.customers.sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
  state.bills.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.stock_movements.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.payments.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));

  renderAll();
}

function activeProducts() {
  return state.products.filter(p => !p.isArchived);
}

function customerName(id) {
  if (!id) return "ลูกค้าเงินสด";
  return state.customers.find(c => c.id === id)?.name || "-";
}

function productById(id) {
  return state.products.find(p => p.id === id);
}

function billItems(billId) {
  return state.bill_items.filter(i => i.billId === billId);
}

function activeBills() {
  return state.bills.filter(b => b.status !== "cancelled");
}

function customerDebt(customerId) {
  const credit = activeBills()
    .filter(b => b.customerId === customerId && (b.paymentType === "credit" || Number(b.creditAmount || 0) > 0))
    .reduce((s, b) => s + Number(b.creditAmount || 0), 0);

  const paid = state.payments
    .filter(p => p.customerId === customerId)
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  return Math.max(0, credit - paid);
}

function totalDebt() {
  return state.customers.reduce((s, c) => s + customerDebt(c.id), 0);
}

function billBadge(b) {
  if (b.status === "cancelled") return `<span class="badge badge-cancelled">ยกเลิก</span>`;
  if (b.paymentType === "credit" || Number(b.creditAmount || 0) > 0) return `<span class="badge badge-credit">เครดิต</span>`;
  return `<span class="badge badge-paid">ชำระแล้ว</span>`;
}

function nextBillNo() {
  const setting = state.settings.find(s => s.id === "main") || {};
  const next = Number(setting.nextBillNo || 1);
  return `KH-${String(next).padStart(6, "0")}`;
}

async function incrementBillNo() {
  const setting = state.settings.find(s => s.id === "main") || { id: "main", nextBillNo: 1 };
  setting.nextBillNo = Number(setting.nextBillNo || 1) + 1;
  setting.updatedAt = new Date().toISOString();
  await put("settings", setting);
}

async function recomputeInventory() {
  const products = await getAll("products");
  const movements = (await getAll("stock_movements"))
    .sort((a, b) => `${a.date || ""} ${a.createdAt || ""}`.localeCompare(`${b.date || ""} ${b.createdAt || ""}`));

  const map = new Map(products.map(p => [p.id, { ...p, stockQty: 0, avgCost: 0 }]));

  for (const m of movements) {
    const p = map.get(m.productId);
    if (!p) continue;

    const inQty = Number(m.qtyIn || 0);
    const outQty = Number(m.qtyOut || 0);
    const unitCost = Number(m.unitCost || 0);

    if (inQty > 0) {
      const oldQty = Number(p.stockQty || 0);
      const oldVal = oldQty * Number(p.avgCost || 0);
      const newQty = oldQty + inQty;
      p.avgCost = newQty > 0 ? (oldVal + inQty * unitCost) / newQty : 0;
      p.stockQty = newQty;
    }

    if (outQty > 0) {
      p.stockQty = Number(p.stockQty || 0) - outQty;
    }
  }

  for (const p of map.values()) {
    await put("products", { ...p, updatedAt: new Date().toISOString() });
  }
}

async function recalcBills() {
  const bills = await getAll("bills");
  const items = await getAll("bill_items");

  for (const b of bills) {
    const its = items.filter(i => i.billId === b.id);
    b.subtotal = its.reduce((s, i) => s + Number(i.revenue || 0), 0);
    b.costTotal = its.reduce((s, i) => s + Number(i.cost || 0), 0);
    b.profitTotal = its.reduce((s, i) => s + Number(i.profit || 0), 0);

    if (b.status !== "cancelled") {
      b.creditAmount = b.paymentType === "credit" ? Math.max(0, Number(b.subtotal || 0) - Number(b.paidAmount || 0)) : 0;
      b.status = b.creditAmount > 0 ? (Number(b.paidAmount || 0) > 0 ? "partial" : "credit") : "paid";
    }

    await put("bills", b);
  }
}

function setOptions(id, rows, placeholder, labelFn) {
  const el = $(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + rows.map(r => `<option value="${r.id}">${labelFn(r)}</option>`).join("");
  if ([...el.options].some(o => o.value === cur)) el.value = cur;
}

function renderAll() {
  renderSelects();
  renderSale();
  renderProducts();
  renderCustomers();
  renderSummary();
  renderMovements();
  renderAdjustments();
  renderLedger();
  renderPayments();
  renderReports();
  renderBillDetail();
  renderBackupStatus();
}

function renderSelects() {
  setOptions("billCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  setOptions("purchaseProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("adjustProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("paymentCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  setOptions("reportCustomer", state.customers, "ลูกค้าทั้งหมด", c => c.name);
}

function renderSale() {
  const q = ($("saleSearch")?.value || "").toLowerCase().trim();
  const products = activeProducts()
    .filter(p => !q || `${p.name} ${p.unit || ""} ${p.note || ""}`.toLowerCase().includes(q))
    .slice(0, 24);

  $("quickProducts").innerHTML = products.map(p => `
    <button class="product-tile" onclick="addProductToCart('${p.id}')" type="button">
      <strong>${p.name}</strong>
      <small>เหลือ ${money(p.stockQty)} ${p.unit || ""} • ทุน ${money(p.avgCost)}</small>
      <div class="tile-price">
        <span>ขาย ${money(p.price)}</span>
        <span>${Number(p.stockQty || 0) <= Number(p.minStock || 0) && Number(p.minStock || 0) > 0 ? "ใกล้หมด" : "พร้อมขาย"}</span>
      </div>
    </button>
  `).join("") || `<div class="list-item"><div><strong>ไม่พบสินค้า</strong><small>เพิ่มสินค้าได้ที่เมนูสินค้า</small></div></div>`;

  $("cartItems").innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-top">
        <strong>${item.name}</strong>
        <button class="small-btn small-danger" onclick="removeCartItem('${item.productId}')">ลบ</button>
      </div>
      <div class="cart-controls">
        <button class="qty-btn" onclick="changeCartQty('${item.productId}', -1)">−</button>
        <span class="money">${money(item.qty)}</span>
        <button class="qty-btn" onclick="changeCartQty('${item.productId}', 1)">+</button>
        <span class="cart-price">${money(item.qty * item.unitPrice)}</span>
      </div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีสินค้าในบิล</strong><small>แตะสินค้าเพื่อเพิ่มลงบิล</small></div></div>`;

  const total = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const cost = cart.reduce((s, i) => s + i.qty * i.unitCost, 0);
  $("cartCount").textContent = cart.length;
  $("cartTotal").textContent = money(total);
  $("cartProfit").textContent = money(total - cost);
  $("currentBillMeta").textContent = `เลขบิลถัดไป: ${nextBillNo()}`;
}

window.addProductToCart = (id) => {
  const p = productById(id);
  if (!p || p.isArchived) return;

  const exist = cart.find(i => i.productId === id);
  if (exist) exist.qty += 1;
  else cart.push({ productId: id, name: p.name, unit: p.unit || "", qty: 1, unitPrice: Number(p.price || 0), unitCost: Number(p.avgCost || 0) });

  renderSale();
  showToast(`เพิ่ม ${p.name} ลงบิล`);
};

window.changeCartQty = (id, delta) => {
  const item = cart.find(i => i.productId === id);
  if (!item) return;
  item.qty = Math.max(0.01, Number(item.qty || 0) + delta);
  renderSale();
};

window.removeCartItem = (id) => {
  cart = cart.filter(i => i.productId !== id);
  renderSale();
};

function clearCart() {
  cart = [];
  $("paidAmount").value = 0;
  $("billNote").value = "";
  renderSale();
}

async function saveBill() {
  if (cart.length === 0) return alert("ยังไม่มีสินค้าในบิล");

  const paymentType = $("paymentType").value;
  const customerId = $("billCustomer").value;

  if (paymentType === "credit" && !customerId) return alert("ขายเครดิตต้องเลือกลูกค้า");

  for (const item of cart) {
    const p = productById(item.productId);
    if (!p || Number(item.qty) > Number(p.stockQty || 0)) return alert(`สต็อกไม่พอ: ${item.name}`);
  }

  const billId = uid();
  const billNo = nextBillNo();
  const date = $("billDate").value || today();
  const subtotal = cart.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const costTotal = cart.reduce((s, i) => s + i.qty * i.unitCost, 0);
  let paidAmount = Number($("paidAmount").value || 0);

  if (paymentType === "cash") paidAmount = subtotal;
  if (paidAmount > subtotal) return alert("รับเงินมากกว่ายอดบิลไม่ได้");

  const creditAmount = paymentType === "credit" ? Math.max(0, subtotal - paidAmount) : 0;
  const now = new Date().toISOString();

  const bill = {
    id: billId,
    billNo,
    date,
    customerId: customerId || "",
    paymentType,
    subtotal,
    costTotal,
    profitTotal: subtotal - costTotal,
    paidAmount,
    creditAmount,
    status: creditAmount > 0 ? (paidAmount > 0 ? "partial" : "credit") : "paid",
    note: $("billNote").value.trim(),
    createdAt: now
  };

  await put("bills", bill);

  for (const item of cart) {
    await put("bill_items", {
      id: uid(),
      billId,
      productId: item.productId,
      productNameSnapshot: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost,
      revenue: item.qty * item.unitPrice,
      cost: item.qty * item.unitCost,
      profit: item.qty * (item.unitPrice - item.unitCost)
    });

    await put("stock_movements", {
      id: uid(),
      productId: item.productId,
      type: "sale",
      refType: "bill",
      refId: billId,
      date,
      qtyIn: 0,
      qtyOut: item.qty,
      unitCost: item.unitCost,
      note: `ขายบิล ${billNo}`,
      createdAt: now
    });
  }

  await incrementBillNo();
  await recomputeInventory();
  await loadState();
  clearCart();
  showToast(`บันทึกขาย ${billNo} แล้ว`);
}

async function cancelBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b || b.status === "cancelled") return;

  const reason = prompt(`เหตุผลการยกเลิกบิล ${b.billNo}\n\nตัวอย่าง: กรอกผิด / ลูกค้ายกเลิก / ทดสอบระบบ`, b.cancelReason || "");
  if (reason === null) return;

  const cleanReason = reason.trim();
  if (!cleanReason) return alert("กรุณาใส่เหตุผลการยกเลิก");

  if (!confirm(`ยืนยันยกเลิกบิล ${b.billNo}?\n\nเหตุผล: ${cleanReason}\n\nระบบจะคืนสต็อกให้อัตโนมัติ`)) return;

  const items = billItems(id);
  const now = new Date().toISOString();

  for (const item of items) {
    await put("stock_movements", {
      id: uid(),
      productId: item.productId,
      type: "sale_cancel",
      refType: "bill",
      refId: id,
      date: today(),
      qtyIn: item.qty,
      qtyOut: 0,
      unitCost: item.unitCost,
      note: `ยกเลิกบิล ${b.billNo}: ${cleanReason}`,
      createdAt: now
    });
  }

  b.status = "cancelled";
  b.creditAmount = 0;
  b.cancelReason = cleanReason;
  b.cancelledAt = now;
  b.updatedAt = now;
  await put("bills", b);

  await recomputeInventory();
  selectedBillId = id;
  await loadState();
  showToast(`ยกเลิกบิล ${b.billNo} แล้ว`);
}

window.cancelBill = cancelBill;

function renderProducts() {
  const q = ($("productSearch")?.value || "").toLowerCase().trim();
  const rows = activeProducts().filter(p => !q || `${p.name} ${p.unit || ""} ${p.note || ""}`.toLowerCase().includes(q));

  $("productsTable").innerHTML = rows.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small>${p.unit || ""} ${p.note ? `• ${p.note}` : ""}</small></td>
      <td>${money(p.stockQty)} ${p.unit || ""}</td>
      <td>${money(p.avgCost)}</td>
      <td>${money(p.price)}</td>
      <td>${Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0) ? '<span class="low">ใกล้หมด</span>' : '<span class="ok-stock">ปกติ</span>'}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn small-edit" onclick="editProduct('${p.id}')">แก้ไข</button>
          <button class="small-btn small-danger" onclick="deleteProduct('${p.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">ยังไม่มีสินค้า</td></tr>`;
}

function resetProductForm() {
  ["productId", "productName", "productUnit", "productNote"].forEach(id => $(id).value = "");
  $("productPrice").value = 0;
  $("productMin").value = 0;
  $("productSubmitBtn").textContent = "บันทึกสินค้า";
}

window.editProduct = (id) => {
  const p = productById(id);
  if (!p) return;

  $("productId").value = p.id;
  $("productName").value = p.name || "";
  $("productUnit").value = p.unit || "";
  $("productPrice").value = p.price || 0;
  $("productMin").value = p.minStock || 0;
  $("productNote").value = p.note || "";
  $("productSubmitBtn").textContent = "อัปเดตสินค้า";
  switchTab("products");
};

async function deleteProduct(id) {
  const p = productById(id);
  if (!p) return;

  const hasHistory = state.bill_items.some(i => i.productId === id) || state.stock_movements.some(m => m.productId === id);

  if (hasHistory) {
    const ok = confirm(`สินค้า "${p.name}" มีประวัติซื้อ/ขายแล้ว\n\nเพื่อไม่ให้ข้อมูลย้อนหลังเสีย ระบบจะ "ซ่อนสินค้า" แทนการลบถาวร\n\nยืนยันซ่อนสินค้านี้ไหม?`);
    if (!ok) return;
    await put("products", { ...p, isArchived: true, updatedAt: new Date().toISOString() });
    await loadState();
    showToast("ซ่อนสินค้าแล้ว");
    return;
  }

  if (confirm(`ลบสินค้า "${p.name}" ใช่ไหม?`)) {
    await del("products", id);
    await loadState();
    showToast("ลบสินค้าแล้ว");
  }
}

window.deleteProduct = deleteProduct;

function renderCustomers() {
  const q = ($("customerSearch")?.value || "").toLowerCase().trim();
  const rows = state.customers.filter(c => !q || `${c.name} ${c.phone || ""} ${c.type || ""}`.toLowerCase().includes(q));

  $("customersTable").innerHTML = rows.map(c => `
    <tr>
      <td><strong>${c.name}</strong><br><small>${c.phone || ""} ${c.note ? `• ${c.note}` : ""}</small></td>
      <td>${c.type || "-"}</td>
      <td class="${customerDebt(c.id) > 0 ? "negative" : ""}">${money(customerDebt(c.id))}</td>
      <td>${money(c.creditLimit || 0)}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn" onclick="openLedger('${c.id}')">สมุดบัญชี</button>
          <button class="small-btn small-edit" onclick="editCustomer('${c.id}')">แก้ไข</button>
          <button class="small-btn small-danger" onclick="deleteCustomer('${c.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5">ยังไม่มีลูกค้า</td></tr>`;
}

function resetCustomerForm() {
  ["customerId", "customerName", "customerPhone", "customerNote"].forEach(id => $(id).value = "");
  $("customerType").value = "ทั่วไป";
  $("customerLimit").value = 0;
  $("customerDays").value = 0;
  $("customerSubmitBtn").textContent = "บันทึกลูกค้า";
}

window.editCustomer = (id) => {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;

  $("customerId").value = c.id;
  $("customerName").value = c.name || "";
  $("customerType").value = c.type || "ทั่วไป";
  $("customerPhone").value = c.phone || "";
  $("customerLimit").value = c.creditLimit || 0;
  $("customerDays").value = c.creditDays || 0;
  $("customerNote").value = c.note || "";
  $("customerSubmitBtn").textContent = "อัปเดตลูกค้า";
  switchTab("customers");
};

async function deleteCustomer(id) {
  if (state.bills.some(b => b.customerId === id) || state.payments.some(p => p.customerId === id)) {
    return alert("ลูกค้านี้มีประวัติแล้ว ไม่ควรลบ ให้แก้ชื่อแทน");
  }

  if (confirm("ลบลูกค้า?")) {
    await del("customers", id);
    await loadState();
  }
}

window.deleteCustomer = deleteCustomer;

function renderSummary() {
  const active = activeBills();
  const todayBills = active.filter(b => String(b.date || "") === today());
  const monthBills = active.filter(b => String(b.date || "").startsWith(today().slice(0, 7)));

  $("todaySales").textContent = money(todayBills.reduce((s, b) => s + Number(b.subtotal || 0), 0));
  $("todayProfit").textContent = money(todayBills.reduce((s, b) => s + Number(b.profitTotal || 0), 0));
  $("monthSales").textContent = money(monthBills.reduce((s, b) => s + Number(b.subtotal || 0), 0));
  $("totalCredit").textContent = money(totalDebt());

  $("lowStockList").innerHTML = activeProducts()
    .filter(p => Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0))
    .map(p => `<div class="list-item"><div><strong>${p.name}</strong><small>เหลือ ${money(p.stockQty)} ${p.unit || ""} / ขั้นต่ำ ${money(p.minStock)}</small></div><div class="low">ใกล้หมด</div></div>`)
    .join("") || `<div class="list-item"><div><strong>ไม่มีสินค้าใกล้หมด</strong></div></div>`;

  const debtors = state.customers
    .map(c => ({ ...c, debt: customerDebt(c.id) }))
    .filter(c => c.debt > 0)
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 5);

  $("topDebtors").innerHTML = debtors.map(c => `<div class="list-item"><div><strong>${c.name}</strong><small>${c.phone || ""}</small></div><div class="money negative">${money(c.debt)}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีลูกหนี้</strong></div></div>`;

  $("summaryRecentBills").innerHTML = active.slice(0, 5).map(b => billRow(b)).join("") || `<div class="list-item"><div><strong>ยังไม่มีบิลขาย</strong></div></div>`;
  renderBackupStatus();
}

function billRow(b) {
  return `<div class="list-item ${b.status === "cancelled" ? "cancelled-row" : ""}">
    <div>
      <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)}</strong>
      <small>${b.date} • ${customerName(b.customerId)} • ${billItems(b.id).length} รายการ</small>
      ${b.status === "cancelled" && b.cancelReason ? `<small>เหตุผลยกเลิก: ${b.cancelReason}</small>` : ""}
    </div>
    <div class="row-actions">
      <div>
        <div class="money">${money(b.subtotal)}</div>
        <small class="${b.profitTotal >= 0 ? "positive" : "negative"}">กำไร ${money(b.profitTotal)}</small>
      </div>
      <button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>
    </div>
  </div>`;
}

function renderRecentBills() {
  $("recentBills").innerHTML = state.bills.slice(0, 8).map(b => billRow(b)).join("") || `<div class="list-item"><div><strong>ยังไม่มีบิลขาย</strong></div></div>`;
}

function renderMovements() {
  $("movementList").innerHTML = state.stock_movements.slice(0, 30).map(m => {
    const p = productById(m.productId);
    const isPurchase = m.type === "purchase";
    const qtyText = Number(m.qtyIn || 0) > 0 ? `+${money(m.qtyIn)}` : `-${money(m.qtyOut)}`;

    return `
      <div class="list-item ${isPurchase ? "" : "movement-sale"}">
        <div>
          <strong>${p?.name || "-"}</strong>
          <small>${m.date} • ${m.type} • ${m.note || ""}</small>
          <small>ทุนต่อหน่วย: ${money(m.unitCost || 0)}</small>
        </div>
        <div class="row-actions">
          <div class="money">${qtyText}</div>
          ${isPurchase ? `<button class="small-btn small-edit" onclick="editPurchase('${m.id}')">แก้ไข</button><button class="small-btn small-danger" onclick="deletePurchase('${m.id}')">ลบ</button>` : `<span class="action-note">จากบิล</span>`}
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติสต็อก</strong></div></div>`;
}

function resetPurchaseForm() {
  $("purchaseId").value = "";
  $("purchaseDate").value = today();
  $("purchaseProduct").value = "";
  $("purchaseQty").value = "";
  $("purchaseCost").value = "";
  $("purchaseNote").value = "";
  $("purchaseSubmitBtn").textContent = "บันทึกซื้อเข้า";
  $("purchaseEditBanner").classList.add("hidden");
  $("cancelPurchaseEditBtn").classList.add("hidden");
}

window.editPurchase = (id) => {
  const m = state.stock_movements.find(x => x.id === id && x.type === "purchase");
  if (!m) return;

  $("purchaseId").value = m.id;
  $("purchaseDate").value = m.date || today();
  $("purchaseProduct").value = m.productId || "";
  $("purchaseQty").value = m.qtyIn || "";
  $("purchaseCost").value = m.unitCost || "";
  $("purchaseNote").value = m.note || "";
  $("purchaseSubmitBtn").textContent = "อัปเดตซื้อเข้า";
  $("purchaseEditBanner").classList.remove("hidden");
  $("cancelPurchaseEditBtn").classList.remove("hidden");
  switchTab("purchase");
};

window.deletePurchase = async (id) => {
  const m = state.stock_movements.find(x => x.id === id && x.type === "purchase");
  if (!m) return;

  if (!confirm(`ลบรายการซื้อเข้า?\n\nสินค้า: ${productById(m.productId)?.name || "-"}\nวันที่: ${m.date}\nจำนวน: ${money(m.qtyIn)}\n\nระบบจะคำนวณสต็อกและทุนเฉลี่ยใหม่`)) return;

  await del("stock_movements", id);
  await recomputeInventory();
  await loadState();
  showToast("ลบรายการซื้อเข้าแล้ว");
};


function renderAdjustments() {
  const list = $("adjustList");
  if (!list) return;

  const rows = state.stock_movements
    .filter(m => m.type === "adjust_in" || m.type === "adjust_out")
    .slice(0, 30);

  list.innerHTML = rows.map(m => {
    const isIn = m.type === "adjust_in";
    const p = productById(m.productId);
    const qty = isIn ? Number(m.qtyIn || 0) : Number(m.qtyOut || 0);
    return `
      <div class="list-item ${isIn ? "adjust-in" : "adjust-out"}">
        <div>
          <strong>${p?.name || "-"}</strong>
          <small>${m.date} • <span class="adjust-type-badge ${isIn ? "adjust-type-in" : "adjust-type-out"}">${isIn ? "ปรับเพิ่ม" : "ปรับลด"}</span> • ${m.note || "-"}</small>
          <small>ทุนต่อหน่วย: ${money(m.unitCost || 0)}</small>
        </div>
        <div class="row-actions">
          <div class="money ${isIn ? "positive" : "negative"}">${isIn ? "+" : "-"}${money(qty)}</div>
          <button class="small-btn small-edit" onclick="editAdjustment('${m.id}')">แก้ไข</button>
          <button class="small-btn small-danger" onclick="deleteAdjustment('${m.id}')">ลบ</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติปรับสต็อก</strong><small>ใช้เมื่อของเสีย ของหาย หรือนับจริงแล้วไม่ตรง</small></div></div>`;
}

function resetAdjustForm() {
  if (!$("adjustForm")) return;
  $("adjustId").value = "";
  $("adjustDate").value = today();
  $("adjustProduct").value = "";
  $("adjustType").value = "adjust_in";
  $("adjustQty").value = "";
  $("adjustCost").value = 0;
  $("adjustNote").value = "";
  $("adjustSubmitBtn").textContent = "บันทึกปรับสต็อก";
  $("adjustEditBanner").classList.add("hidden");
  $("cancelAdjustEditBtn").classList.add("hidden");
}

window.editAdjustment = (id) => {
  const m = state.stock_movements.find(x => x.id === id && (x.type === "adjust_in" || x.type === "adjust_out"));
  if (!m) return;

  $("adjustId").value = m.id;
  $("adjustDate").value = m.date || today();
  $("adjustProduct").value = m.productId || "";
  $("adjustType").value = m.type;
  $("adjustQty").value = Number(m.qtyIn || 0) > 0 ? m.qtyIn : m.qtyOut;
  $("adjustCost").value = m.unitCost || 0;
  $("adjustNote").value = m.note || "";
  $("adjustSubmitBtn").textContent = "อัปเดตปรับสต็อก";
  $("adjustEditBanner").classList.remove("hidden");
  $("cancelAdjustEditBtn").classList.remove("hidden");
  switchTab("adjust");
};

window.deleteAdjustment = async (id) => {
  const m = state.stock_movements.find(x => x.id === id && (x.type === "adjust_in" || x.type === "adjust_out"));
  if (!m) return;

  const p = productById(m.productId);
  const qty = Number(m.qtyIn || 0) > 0 ? m.qtyIn : m.qtyOut;
  if (!confirm(`ลบรายการปรับสต็อก?\n\nสินค้า: ${p?.name || "-"}\nจำนวน: ${money(qty)}\nเหตุผล: ${m.note || "-"}\n\nระบบจะคำนวณสต็อกใหม่`)) return;

  await del("stock_movements", id);
  await recomputeInventory();
  await loadState();
  showToast("ลบรายการปรับสต็อกแล้ว");
};

function renderLedger() {
  const q = ($("ledgerSearch")?.value || "").toLowerCase().trim();
  const rows = state.customers
    .map(c => ({ ...c, debt: customerDebt(c.id) }))
    .filter(c => !q || `${c.name} ${c.phone || ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.debt - a.debt);

  $("ledgerCustomers").innerHTML = rows.map(c => `<div class="list-item" onclick="openLedger('${c.id}')"><div><strong>${c.name}</strong><small>${c.type || ""}</small></div><div class="money ${c.debt > 0 ? "negative" : "positive"}">${money(c.debt)}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีลูกค้า</strong></div></div>`;

  const c = state.customers.find(x => x.id === selectedLedgerCustomerId);
  if (!c) {
    $("ledgerTitle").textContent = "สมุดบัญชี";
    $("ledgerBalance").textContent = money(0);
    $("ledgerCreditSales").textContent = money(0);
    $("ledgerPaid").textContent = money(0);
    $("ledgerEntries").innerHTML = `<div class="list-item"><div><strong>เลือกลูกค้าด้านซ้าย</strong></div></div>`;
    return;
  }

  const bills = activeBills().filter(b => b.customerId === c.id && b.paymentType === "credit");
  const payments = state.payments.filter(p => p.customerId === c.id);

  $("ledgerTitle").textContent = c.name;
  $("ledgerBalance").textContent = money(customerDebt(c.id));
  $("ledgerCreditSales").textContent = money(bills.reduce((s, b) => s + Number(b.subtotal || 0), 0));
  $("ledgerPaid").textContent = money(payments.reduce((s, p) => s + Number(p.amount || 0), 0));

  const entries = [
    ...bills.map(b => ({ date: b.date, createdAt: b.createdAt || "", title: `บิล ${b.billNo}`, detail: `ขายเครดิต ${billItems(b.id).length} รายการ`, amount: Number(b.creditAmount || 0), type: "sale" })),
    ...payments.map(p => ({ date: p.date, createdAt: p.createdAt || "", title: "รับเงิน", detail: p.method || "", amount: -Number(p.amount || 0), type: "pay" }))
  ].sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));

  $("ledgerEntries").innerHTML = entries.map(e => `<div class="list-item"><div><strong>${e.title}</strong><small>${e.date} • ${e.detail}</small></div><div class="money ${e.amount > 0 ? "negative" : "positive"}">${e.amount > 0 ? "+" : "-"}${money(Math.abs(e.amount))}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติเครดิต</strong></div></div>`;
}

window.openLedger = (id) => {
  selectedLedgerCustomerId = id;
  renderLedger();
  switchTab("ledger");
};

function renderPayments() {
  $("paymentList").innerHTML = state.payments.slice(0, 30).map(p => `
    <div class="list-item">
      <div>
        <strong>${customerName(p.customerId)}</strong>
        <small>${p.date} • ${p.method} ${p.note ? `• ${p.note}` : ""}</small>
      </div>
      <div class="row-actions">
        <div class="money positive">${money(p.amount)}</div>
        <button class="small-btn small-edit" onclick="editPayment('${p.id}')">แก้ไข</button>
        <button class="small-btn small-danger" onclick="deletePayment('${p.id}')">ลบ</button>
      </div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติรับเงิน</strong></div></div>`;
}

function resetPaymentForm() {
  $("paymentId").value = "";
  $("paymentDate").value = today();
  $("paymentCustomer").value = "";
  $("paymentAmount").value = "";
  $("paymentMethod").value = "เงินสด";
  $("paymentNote").value = "";
  $("paymentSubmitBtn").textContent = "บันทึกรับเงิน";
  $("paymentEditBanner").classList.add("hidden");
  $("cancelPaymentEditBtn").classList.add("hidden");
}

window.editPayment = (id) => {
  const p = state.payments.find(x => x.id === id);
  if (!p) return;

  $("paymentId").value = p.id;
  $("paymentDate").value = p.date || today();
  $("paymentCustomer").value = p.customerId || "";
  $("paymentAmount").value = p.amount || "";
  $("paymentMethod").value = p.method || "เงินสด";
  $("paymentNote").value = p.note || "";
  $("paymentSubmitBtn").textContent = "อัปเดตรับเงิน";
  $("paymentEditBanner").classList.remove("hidden");
  $("cancelPaymentEditBtn").classList.remove("hidden");
  switchTab("payments");
};

window.deletePayment = async (id) => {
  const p = state.payments.find(x => x.id === id);
  if (!p) return;

  if (!confirm(`ลบรายการรับเงิน?\n\nลูกค้า: ${customerName(p.customerId)}\nวันที่: ${p.date}\nจำนวน: ${money(p.amount)} บาท\n\nยอดค้างจะถูกคำนวณใหม่`)) return;

  await del("payments", id);
  await loadState();
  showToast("ลบรายการรับเงินแล้ว");
};

function filteredBills() {
  const from = $("reportFrom")?.value || "";
  const to = $("reportTo")?.value || "";
  const customerId = $("reportCustomer")?.value || "";
  const type = $("reportPaymentType")?.value || "";

  return state.bills.filter(b => {
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    if (customerId && b.customerId !== customerId) return false;
    if (type && b.paymentType !== type) return false;
    return true;
  });
}

function renderReports() {
  const rows = filteredBills();
  const activeRows = rows.filter(b => b.status !== "cancelled");

  $("reportSales").textContent = money(activeRows.reduce((s, b) => s + Number(b.subtotal || 0), 0));
  $("reportCost").textContent = money(activeRows.reduce((s, b) => s + Number(b.costTotal || 0), 0));
  $("reportProfit").textContent = money(activeRows.reduce((s, b) => s + Number(b.profitTotal || 0), 0));
  $("reportCount").textContent = activeRows.length.toLocaleString("th-TH");

  $("reportBills").innerHTML = rows.map(b => `<tr class="${b.status === "cancelled" ? "cancelled-row" : ""}">
    <td><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button></td>
    <td>${b.date}</td>
    <td>${customerName(b.customerId)}</td>
    <td>${money(b.subtotal)}</td>
    <td class="${b.profitTotal >= 0 ? "positive" : "negative"}">${money(b.profitTotal)}</td>
    <td>${billBadge(b)}</td>
    <td><div class="row-actions"><button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>${b.status !== "cancelled" ? `<button class="small-btn small-danger" onclick="cancelBill('${b.id}')">ยกเลิก</button>` : ""}</div></td>
  </tr>`).join("") || `<tr><td colspan="7">ไม่พบรายการขาย</td></tr>`;
}


function renderBillDetail() {
  const wrap = $("billDetailContent");
  if (!wrap) return;

  const b = state.bills.find(x => x.id === selectedBillId);
  if (!b) {
    wrap.innerHTML = `<div class="panel"><div class="list-item"><div><strong>ยังไม่ได้เลือกบิล</strong><small>ไปที่รายงานหรือบิลล่าสุด แล้วกดดูบิล</small></div></div></div>`;
    return;
  }

  const items = billItems(b.id);
  const isCancelled = b.status === "cancelled";

  wrap.innerHTML = `
    <div class="bill-hero">
      <div class="bill-hero-top">
        <div>
          <h3>${b.billNo} ${billBadge(b)}</h3>
          <small>${b.date} • ${customerName(b.customerId)} • ${items.length} รายการ</small>
        </div>
        <div class="row-actions">
          <button class="soft-btn" onclick="switchTab('reports')">กลับรายงาน</button>
          ${!isCancelled ? `<button class="danger-btn" onclick="cancelBill('${b.id}')">ยกเลิกบิล</button>` : ""}
        </div>
      </div>

      <div class="bill-detail-kpis">
        <div><span>ยอดขาย</span><strong>${money(b.subtotal)}</strong></div>
        <div><span>ต้นทุน</span><strong>${money(b.costTotal)}</strong></div>
        <div><span>กำไร</span><strong class="${Number(b.profitTotal || 0) >= 0 ? "positive" : "negative"}">${money(b.profitTotal)}</strong></div>
        <div><span>ยอดค้าง</span><strong>${money(b.creditAmount)}</strong></div>
      </div>

      ${isCancelled ? `<div class="bill-cancel-box">
        <div>บิลนี้ถูกยกเลิกแล้ว</div>
        <div>เหตุผล: ${b.cancelReason || "-"}</div>
        <div>เวลายกเลิก: ${b.cancelledAt ? new Date(b.cancelledAt).toLocaleString("th-TH") : "-"}</div>
      </div>` : ""}
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>รายการสินค้าในบิล</h3>
        <span class="hint">ราคาขาย / ต้นทุน / กำไร ต่อรายการ</span>
      </div>
      <div class="stack-list">
        ${items.map(item => `
          <div class="bill-item-row">
            <div>
              <strong>${item.productNameSnapshot || productById(item.productId)?.name || "-"}</strong>
              <small>จำนวน ${money(item.qty)} • ราคาขาย ${money(item.unitPrice)} • ต้นทุน ${money(item.unitCost)}</small>
            </div>
            <div class="bill-item-price">
              <strong>${money(item.revenue)}</strong>
              <small class="${Number(item.profit || 0) >= 0 ? "positive" : "negative"}">กำไร ${money(item.profit)}</small>
            </div>
          </div>
        `).join("") || `<div class="list-item"><div><strong>ไม่มีรายการสินค้าในบิล</strong></div></div>`}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>รายละเอียดการชำระเงิน</h3></div>
      <div class="stack-list">
        <div class="list-item"><div><strong>ประเภทชำระเงิน</strong><small>${b.paymentType === "credit" ? "เครดิต/ค้างชำระ" : "เงินสด/โอนแล้ว"}</small></div></div>
        <div class="list-item"><div><strong>รับเงินแล้ว</strong></div><div class="money positive">${money(b.paidAmount)}</div></div>
        <div class="list-item"><div><strong>หมายเหตุ</strong><small>${b.note || "-"}</small></div></div>
      </div>
    </div>
  `;
}

window.openBillDetail = (id) => {
  selectedBillId = id;
  renderBillDetail();
  switchTab("billDetail");
};

function renderBackupStatus() {
  const t = localStorage.getItem("khaikhongV2LastBackup");
  if ($("backupStatus")) $("backupStatus").textContent = `Backup: ${t ? new Date(t).toLocaleString("th-TH") : "ยังไม่เคย"}`;
}

function switchTab(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tab,[data-open-tab]").forEach(el => el.addEventListener("click", () => switchTab(el.dataset.tab || el.dataset.openTab)));

function setDates() {
  ["billDate", "purchaseDate", "paymentDate", "adjustDate"].forEach(id => $(id).value = today());
}

$("paymentType").addEventListener("change", () => {
  $("customerField").classList.toggle("hidden-field", $("paymentType").value !== "credit");
});

$("saleSearch").addEventListener("input", renderSale);
$("productSearch").addEventListener("input", renderProducts);
$("customerSearch").addEventListener("input", renderCustomers);
$("ledgerSearch").addEventListener("input", renderLedger);
$("clearLedgerBtn").addEventListener("click", () => { selectedLedgerCustomerId = ""; renderLedger(); });
$("clearCartBtn").addEventListener("click", clearCart);
$("saveBillBtn").addEventListener("click", saveBill);

$("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = $("productId").value || uid();
  const old = productById(id) || {};
  const name = $("productName").value.trim();

  if (!name) return alert("กรุณาใส่ชื่อสินค้า");

  await put("products", {
    ...old,
    id,
    name,
    unit: $("productUnit").value.trim(),
    price: Number($("productPrice").value || 0),
    minStock: Number($("productMin").value || 0),
    note: $("productNote").value.trim(),
    stockQty: Number(old.stockQty || 0),
    avgCost: Number(old.avgCost || 0),
    isArchived: false,
    createdAt: old.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  resetProductForm();
  await loadState();
  showToast("บันทึกสินค้าแล้ว");
});

$("resetProductBtn").addEventListener("click", resetProductForm);

$("customerForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = $("customerId").value || uid();
  const old = state.customers.find(c => c.id === id) || {};
  const name = $("customerName").value.trim();

  if (!name) return alert("กรุณาใส่ชื่อลูกค้า");

  await put("customers", {
    ...old,
    id,
    name,
    type: $("customerType").value,
    phone: $("customerPhone").value.trim(),
    creditLimit: Number($("customerLimit").value || 0),
    creditDays: Number($("customerDays").value || 0),
    note: $("customerNote").value.trim(),
    createdAt: old.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  resetCustomerForm();
  await loadState();
  showToast("บันทึกลูกค้าแล้ว");
});

$("resetCustomerBtn").addEventListener("click", resetCustomerForm);

$("purchaseForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const productId = $("purchaseProduct").value;
  const qty = Number($("purchaseQty").value || 0);
  const cost = Number($("purchaseCost").value || 0);
  const editId = $("purchaseId").value;

  if (!productId) return alert("กรุณาเลือกสินค้า");
  if (qty <= 0) return alert("กรุณาใส่จำนวน");
  if (cost <= 0 && !confirm("ทุนต่อหน่วยเป็น 0 ต้องการบันทึกต่อไหม?")) return;

  const old = editId ? state.stock_movements.find(m => m.id === editId) : null;

  await put("stock_movements", {
    ...(old || {}),
    id: editId || uid(),
    productId,
    type: "purchase",
    refType: "purchase",
    refId: "",
    date: $("purchaseDate").value || today(),
    qtyIn: qty,
    qtyOut: 0,
    unitCost: cost,
    note: $("purchaseNote").value.trim(),
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  resetPurchaseForm();
  await recomputeInventory();
  await loadState();
  showToast(editId ? "อัปเดตซื้อเข้าแล้ว" : "บันทึกซื้อเข้าแล้ว");
});

$("cancelPurchaseEditBtn").addEventListener("click", resetPurchaseForm);

$("paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const customerId = $("paymentCustomer").value;
  const amount = Number($("paymentAmount").value || 0);
  const editId = $("paymentId").value;

  if (!customerId) return alert("กรุณาเลือกลูกค้า");
  if (amount <= 0) return alert("กรุณาใส่จำนวนเงิน");

  const old = editId ? state.payments.find(p => p.id === editId) : null;

  await put("payments", {
    ...(old || {}),
    id: editId || uid(),
    customerId,
    billId: "",
    date: $("paymentDate").value || today(),
    amount,
    method: $("paymentMethod").value,
    note: $("paymentNote").value.trim(),
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  resetPaymentForm();
  await loadState();
  showToast(editId ? "อัปเดตรับเงินแล้ว" : "บันทึกรับเงินแล้ว");
});

$("cancelPaymentEditBtn").addEventListener("click", resetPaymentForm);


const adjustForm = $("adjustForm");
if (adjustForm) {
  adjustForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const productId = $("adjustProduct").value;
    const type = $("adjustType").value;
    const qty = Number($("adjustQty").value || 0);
    const cost = Number($("adjustCost").value || 0);
    const note = $("adjustNote").value.trim();
    const editId = $("adjustId").value;

    if (!productId) return alert("กรุณาเลือกสินค้า");
    if (qty <= 0) return alert("กรุณาใส่จำนวน");
    if (!note && !confirm("ยังไม่ได้ใส่เหตุผล ต้องการบันทึกต่อไหม?")) return;

    if (type === "adjust_out") {
      const p = productById(productId);
      const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
      const oldQtySameProduct = old && old.productId === productId && old.type === "adjust_out" ? Number(old.qtyOut || 0) : 0;
      const available = Number(p?.stockQty || 0) + oldQtySameProduct;
      if (qty > available) return alert(`สต็อกไม่พอ เหลือ ${money(available)} ${p?.unit || ""}`);
    }

    if (type === "adjust_in" && cost <= 0 && !confirm("ทุนต่อหน่วยเป็น 0 ต้องการบันทึกต่อไหม?")) return;

    const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
    await put("stock_movements", {
      ...(old || {}),
      id: editId || uid(),
      productId,
      type,
      refType: "adjust",
      refId: "",
      date: $("adjustDate").value || today(),
      qtyIn: type === "adjust_in" ? qty : 0,
      qtyOut: type === "adjust_out" ? qty : 0,
      unitCost: type === "adjust_in" ? cost : Number(old?.unitCost || productById(productId)?.avgCost || 0),
      note,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    resetAdjustForm();
    await recomputeInventory();
    await loadState();
    showToast(editId ? "อัปเดตปรับสต็อกแล้ว" : "บันทึกปรับสต็อกแล้ว");
  });

  $("cancelAdjustEditBtn").addEventListener("click", resetAdjustForm);
}

["reportFrom", "reportTo", "reportCustomer", "reportPaymentType"].forEach(id => $(id).addEventListener("input", renderReports));

$("filterTodayBtn").addEventListener("click", () => {
  $("reportFrom").value = today();
  $("reportTo").value = today();
  renderReports();
});

$("filterMonthBtn").addEventListener("click", () => {
  const p = today().slice(0, 7);
  $("reportFrom").value = `${p}-01`;
  const last = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  $("reportTo").value = `${p}-${String(last).padStart(2, "0")}`;
  renderReports();
});

$("resetFilterBtn").addEventListener("click", () => {
  
const adjustForm = $("adjustForm");
if (adjustForm) {
  adjustForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const productId = $("adjustProduct").value;
    const type = $("adjustType").value;
    const qty = Number($("adjustQty").value || 0);
    const cost = Number($("adjustCost").value || 0);
    const note = $("adjustNote").value.trim();
    const editId = $("adjustId").value;

    if (!productId) return alert("กรุณาเลือกสินค้า");
    if (qty <= 0) return alert("กรุณาใส่จำนวน");
    if (!note && !confirm("ยังไม่ได้ใส่เหตุผล ต้องการบันทึกต่อไหม?")) return;

    if (type === "adjust_out") {
      const p = productById(productId);
      const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
      const oldQtySameProduct = old && old.productId === productId && old.type === "adjust_out" ? Number(old.qtyOut || 0) : 0;
      const available = Number(p?.stockQty || 0) + oldQtySameProduct;
      if (qty > available) return alert(`สต็อกไม่พอ เหลือ ${money(available)} ${p?.unit || ""}`);
    }

    if (type === "adjust_in" && cost <= 0 && !confirm("ทุนต่อหน่วยเป็น 0 ต้องการบันทึกต่อไหม?")) return;

    const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
    await put("stock_movements", {
      ...(old || {}),
      id: editId || uid(),
      productId,
      type,
      refType: "adjust",
      refId: "",
      date: $("adjustDate").value || today(),
      qtyIn: type === "adjust_in" ? qty : 0,
      qtyOut: type === "adjust_out" ? qty : 0,
      unitCost: type === "adjust_in" ? cost : Number(old?.unitCost || productById(productId)?.avgCost || 0),
      note,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    resetAdjustForm();
    await recomputeInventory();
    await loadState();
    showToast(editId ? "อัปเดตปรับสต็อกแล้ว" : "บันทึกปรับสต็อกแล้ว");
  });

  $("cancelAdjustEditBtn").addEventListener("click", resetAdjustForm);
}

["reportFrom", "reportTo", "reportCustomer", "reportPaymentType"].forEach(id => $(id).value = "");
  renderReports();
});

function download(filename, content, type = "application/octet-stream") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$("exportCsvBtn").addEventListener("click", () => {
  const rows = [["billNo", "date", "customer", "subtotal", "cost", "profit", "status"]];
  filteredBills().forEach(b => rows.push([b.billNo, b.date, customerName(b.customerId), b.subtotal, b.costTotal, b.profitTotal, b.status]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`khaikhong-v2-report-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
});

$("exportBackupBtn").addEventListener("click", () => {
  const data = { app: "Khaikhong", version: "2.0.4", exportedAt: new Date().toISOString(), ...state };
  localStorage.setItem("khaikhongV2LastBackup", new Date().toISOString());
  download(`khaikhong-v2-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
  renderBackupStatus();
  showToast("สร้าง Backup แล้ว");
});

$("importBackupInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const data = JSON.parse(await file.text());
  if (!confirm("นำเข้า Backup จะเขียนทับข้อมูลในเครื่องนี้ ต้องการทำต่อไหม?")) return;

  for (const s of STORES) await clearStore(s);
  for (const s of STORES) {
    for (const item of (data[s] || [])) await put(s, item);
  }

  await recomputeInventory();
  await recalcBills();
  await loadState();
  showToast("นำเข้า Backup แล้ว");
});

$("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("ล้างข้อมูลทั้งหมด? แนะนำให้ Backup ก่อน")) return;

  for (const s of STORES) await clearStore(s);
  cart = [];
  await loadState();
  showToast("ล้างข้อมูลแล้ว");
});

function openNumberPad(input) {
  currentNumberInput = input;
  numberPadValue = String(input.value || "");
  $("numpadTargetLabel").textContent = input.closest("label")?.childNodes[0]?.textContent?.trim() || "ใส่ตัวเลข";
  $("numpadDisplay").textContent = numberPadValue || "0";
  $("numberPadOverlay").classList.remove("hidden");
}

function closeNumberPad() {
  $("numberPadOverlay").classList.add("hidden");
  currentNumberInput = null;
  numberPadValue = "";
}

function setPad(v) {
  numberPadValue = v;
  $("numpadDisplay").textContent = numberPadValue || "0";
}

document.addEventListener("focusin", (e) => {
  if (e.target?.matches?.('input[data-keypad="true"]')) {
    e.target.blur();
    openNumberPad(e.target);
  }
});

document.querySelectorAll("[data-num]").forEach(btn => btn.addEventListener("click", () => {
  const n = btn.dataset.num;
  if (n === "." && numberPadValue.includes(".")) return;
  if (numberPadValue === "0" && n !== ".") setPad(n);
  else setPad(numberPadValue + n);
}));

$("numpadBack").addEventListener("click", () => setPad(numberPadValue.slice(0, -1)));
$("numpadClear").addEventListener("click", () => setPad(""));
$("numpadOk").addEventListener("click", () => {
  if (currentNumberInput) {
    currentNumberInput.value = numberPadValue || "0";
    currentNumberInput.dispatchEvent(new Event("input", { bubbles: true }));
    currentNumberInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeNumberPad();
});
$("numpadClose").addEventListener("click", closeNumberPad);
$("numberPadOverlay").addEventListener("click", (e) => { if (e.target.id === "numberPadOverlay") closeNumberPad(); });

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").classList.remove("hidden");
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
}

(async function init() {
  db = await openDB();
  setDates();
  resetPurchaseForm();
  resetPaymentForm();
  resetAdjustForm();
  await recomputeInventory();
  await recalcBills();
  await loadState();
})();
