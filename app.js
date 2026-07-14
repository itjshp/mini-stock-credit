const DB_NAME = "khaikhong-v2-db";
const DB_VERSION = 1;
const STORES = ["products","customers","bills","bill_items","payments","stock_movements","settings"];

let db;
let state = { products: [], customers: [], bills: [], bill_items: [], payments: [], stock_movements: [], settings: [] };
let cart = [];
let selectedLedgerCustomerId = "";
let selectedCustomerDetailId = "";
let selectedProductId = "";
let selectedBillId = "";
let currentNumberInput = null;
let numberPadValue = "";
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function mainSettings() {
  return state.settings.find(s => s.id === "main") || {
    id: "main",
    shopName: "Khaikhong",
    subtitle: "ขายง่าย • รู้กำไร • ไม่ลืมลูกหนี้ • คุมสต็อก",
    billPrefix: "KH",
    nextBillNo: 1,
    useNumberPad: true
  };
}

function isNumberPadEnabled() {
  return mainSettings().useNumberPad !== false;
}

function formatBillNo(prefix, nextNo) {
  const cleanPrefix = String(prefix || "KH").trim() || "KH";
  return `${cleanPrefix}-${String(Number(nextNo || 1)).padStart(6, "0")}`;
}


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


function customerById(id) {
  return state.customers.find(c => c.id === id);
}

function isWholesaleCustomer(customerId) {
  const c = customerById(customerId);
  return String(c?.type || "").includes("ขายส่ง");
}

function productRetailPrice(p) {
  return Number(p?.price || 0);
}

function productWholesalePrice(p) {
  const wholesale = Number(p?.wholesalePrice || 0);
  return wholesale > 0 ? wholesale : productRetailPrice(p);
}

function salePriceForProduct(p, customerId = $("billCustomer")?.value || "") {
  return isWholesaleCustomer(customerId) ? productWholesalePrice(p) : productRetailPrice(p);
}

function salePriceModeLabel(customerId = $("billCustomer")?.value || "") {
  return isWholesaleCustomer(customerId) ? "ราคาขายส่ง" : "ราคาขายปลีก";
}

function refreshCartPricesForCustomer() {
  const customerId = $("billCustomer")?.value || "";
  cart = cart.map(item => {
    const p = productById(item.productId);
    if (!p) return item;
    return { ...item, unitPrice: salePriceForProduct(p, customerId) };
  });
  renderSale();
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
  const billDebt = activeBills()
    .filter(b => b.customerId === customerId && (b.paymentType === "credit" || Number(b.creditAmount || 0) > 0))
    .reduce((s, b) => s + Number(b.creditAmount || 0), 0);

  // รองรับ payment เก่าที่เคยรับเงินแบบไม่ผูกบิล
  const unlinkedPaid = state.payments
    .filter(p => p.customerId === customerId && !p.billId)
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  return Math.max(0, billDebt - unlinkedPaid);
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
  const setting = mainSettings();
  const next = Number(setting.nextBillNo || 1);
  return formatBillNo(setting.billPrefix || "KH", next);
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

    // ปรับทุนเฉลี่ยโดยไม่เปลี่ยนจำนวนสต็อก
    if (m.type === "cost_adjust") {
      if (unitCost >= 0) p.avgCost = unitCost;
      continue;
    }

    if (inQty > 0) {
      // ถ้าเคยมีสต็อกติดลบจากข้อมูลเก่า ห้ามใช้จำนวนติดลบไปถ่วงทุน
      const currentQty = Number(p.stockQty || 0);
      const oldQtyForCost = Math.max(0, currentQty);
      const oldVal = oldQtyForCost * Number(p.avgCost || 0);
      const costQty = oldQtyForCost + inQty;
      p.avgCost = costQty > 0 ? (oldVal + inQty * unitCost) / costQty : 0;
      p.stockQty = currentQty + inQty;
    }

    if (outQty > 0) {
      p.stockQty = Number(p.stockQty || 0) - outQty;
    }
  }

  for (const p of map.values()) {
    await put("products", { ...p, updatedAt: new Date().toISOString() });
  }
}


async function rebuildCostSnapshots() {
  const products = await getAll("products");
  const movements = (await getAll("stock_movements"))
    .sort((a, b) => `${a.date || ""} ${a.createdAt || ""}`.localeCompare(`${b.date || ""} ${b.createdAt || ""}`));
  const items = await getAll("bill_items");

  const sim = new Map(products.map(p => [p.id, { qty: 0, avgCost: 0 }]));
  const itemsToUpdate = new Map();

  for (const m of movements) {
    const p = sim.get(m.productId);
    if (!p) continue;

    const inQty = Number(m.qtyIn || 0);
    const outQty = Number(m.qtyOut || 0);

    if (m.type === "cost_adjust") {
      p.avgCost = Number(m.unitCost || 0);
      await put("stock_movements", { ...m, unitCost: p.avgCost, updatedAt: new Date().toISOString() });
      continue;
    }

    if (inQty > 0) {
      const unitCost = Number(m.unitCost || 0);
      const oldQtyForCost = Math.max(0, Number(p.qty || 0));
      const oldVal = oldQtyForCost * Number(p.avgCost || 0);
      const costQty = oldQtyForCost + inQty;
      p.avgCost = costQty > 0 ? (oldVal + inQty * unitCost) / costQty : 0;
      p.qty = Number(p.qty || 0) + inQty;
      continue;
    }

    if (outQty > 0) {
      const saleCost = Number(p.avgCost || 0);

      if (m.type === "sale" || m.type === "adjust_out") {
        await put("stock_movements", { ...m, unitCost: saleCost, updatedAt: new Date().toISOString() });
      }

      if (m.type === "sale" && m.refType === "bill" && m.refId) {
        items
          .filter(item => item.billId === m.refId && item.productId === m.productId)
          .forEach(item => {
            const updated = {
              ...item,
              unitCost: saleCost,
              cost: Number(item.qty || 0) * saleCost,
              profit: Number(item.revenue || 0) - Number(item.qty || 0) * saleCost
            };
            itemsToUpdate.set(item.id, updated);
          });
      }

      p.qty = Number(p.qty || 0) - outQty;
    }
  }

  for (const item of itemsToUpdate.values()) {
    await put("bill_items", item);
  }

  await recalcBills();
  await recomputeInventory();
}

async function recalcBills() {
  const bills = await getAll("bills");
  const items = await getAll("bill_items");
  const payments = await getAll("payments");

  for (const b of bills) {
    const its = items.filter(i => i.billId === b.id);
    b.subtotal = its.reduce((s, i) => s + Number(i.revenue || 0), 0);
    b.costTotal = its.reduce((s, i) => s + Number(i.cost || 0), 0);
    b.profitTotal = its.reduce((s, i) => s + Number(i.profit || 0), 0);

    // เก็บเงินที่รับตอนออกบิลไว้แยกจากเงินที่รับทีหลัง
    if (b.initialPaidAmount === undefined || b.initialPaidAmount === null) {
      const linkedPaid = payments
        .filter(p => p.billId === b.id)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      b.initialPaidAmount = Math.max(0, Number(b.paidAmount || 0) - linkedPaid);
    }

    if (b.status !== "cancelled") {
      const linkedPaid = payments
        .filter(p => p.billId === b.id)
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      b.paidAmount = Number(b.initialPaidAmount || 0) + linkedPaid;
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
  renderProductDetail();
  renderCustomers();
  renderCustomerDetail();
  renderSummary();
  renderDailyClose();
  renderLowStockCenter();
  renderMovements();
  renderAdjustments();
  renderLedger();
  renderPayments();
  renderOutstandingBills();
  renderReports();
  renderBillDetail();
  renderBackupStatus();
  renderSettingsUI();
  renderTestSummary();
}

function renderSelects() {
  setOptions("billCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  setOptions("purchaseProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("adjustProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("paymentCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  renderPaymentBillOptions();
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
        <span class="${isWholesaleCustomer($('billCustomer')?.value || '') ? 'wholesale-price' : 'retail-price'}">${isWholesaleCustomer($('billCustomer')?.value || '') ? 'ส่ง' : 'ปลีก'} ${money(salePriceForProduct(p))}</span>
        <span>${Number(p.stockQty || 0) <= Number(p.minStock || 0) && Number(p.minStock || 0) > 0 ? "ใกล้หมด" : "พร้อมขาย"}</span>
      </div>
    </button>
  `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">📦</div><strong>ไม่พบสินค้า</strong><small>เพิ่มสินค้าได้ที่เมนูสินค้า</small></div></div>`;

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
  `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🛒</div><strong>บิลยังว่างอยู่</strong><small>แตะสินค้าเพื่อเพิ่มลงบิล</small></div></div>`;

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
  else cart.push({ productId: id, name: p.name, unit: p.unit || "", qty: 1, unitPrice: salePriceForProduct(p), unitCost: Number(p.avgCost || 0) });

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
    initialPaidAmount: paidAmount,
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
      <td class="wholesale-price">${money(productWholesalePrice(p))}</td>
      <td>${Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0) ? '<span class="low">ใกล้หมด</span>' : '<span class="ok-stock">ปกติ</span>'}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn" onclick="openProductDetail('${p.id}')">รายละเอียด</button>
          <button class="small-btn small-edit" onclick="editProduct('${p.id}')">แก้ไข</button>
          <button class="small-btn small-danger" onclick="deleteProduct('${p.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7">ยังไม่มีสินค้า</td></tr>`;
}

function resetProductForm() {
  ["productId", "productName", "productUnit", "productNote"].forEach(id => $(id).value = "");
  $("productPrice").value = 0;
  if ($("productWholesalePrice")) $("productWholesalePrice").value = 0;
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
  if ($("productWholesalePrice")) $("productWholesalePrice").value = p.wholesalePrice || p.price || 0;
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


function getProductBillItems(productId) {
  return state.bill_items
    .filter(item => item.productId === productId)
    .map(item => ({ ...item, bill: state.bills.find(b => b.id === item.billId) }))
    .filter(row => row.bill)
    .sort((a, b) => `${b.bill.date || ""} ${b.bill.createdAt || ""}`.localeCompare(`${a.bill.date || ""} ${a.bill.createdAt || ""}`));
}

function getProductMovements(productId) {
  return state.stock_movements
    .filter(m => m.productId === productId)
    .sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function renderProductDetail() {
  const wrap = $("productDetailContent");
  if (!wrap) return;

  const p = productById(selectedProductId);
  if (!p) {
    wrap.innerHTML = `<div class="panel"><div class="list-item"><div><strong>ยังไม่ได้เลือกสินค้า</strong><small>ไปที่หน้าสินค้า แล้วกดปุ่มรายละเอียด</small></div></div></div>`;
    return;
  }

  const items = getProductBillItems(p.id);
  const activeItems = items.filter(row => row.bill.status !== "cancelled");
  const movements = getProductMovements(p.id);

  const soldQty = activeItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const soldRevenue = activeItems.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const productProfit = activeItems.reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const lowStock = Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0);

  wrap.innerHTML = `
    <div class="product-hero">
      <div class="product-hero-top">
        <div>
          <h3>${p.name}</h3>
          <small>${p.unit || "-"} ${p.note ? "• " + p.note : ""}</small>
        </div>
        <div class="row-actions">
          <button class="soft-btn" onclick="quickPurchaseProduct('${p.id}')">ซื้อเข้า</button>
          <button class="soft-btn" onclick="quickAdjustProduct('${p.id}')">ปรับสต็อก</button>
          <button class="small-btn small-edit" onclick="editProduct('${p.id}')">แก้ไข</button>
        </div>
      </div>

      <div class="product-detail-kpis">
        <div><span>สต็อกคงเหลือ</span><strong>${money(p.stockQty)} ${p.unit || ""}</strong></div>
        <div><span>ทุนเฉลี่ย</span><strong>${money(p.avgCost)}</strong></div>
        <div><span>ราคาปลีก</span><strong>${money(p.price)}</strong></div><div><span>ราคาส่ง</span><strong class="wholesale-price">${money(productWholesalePrice(p))}</strong></div>
        <div><span>สถานะ</span><strong class="${lowStock ? "low" : "ok-stock"}">${lowStock ? "ใกล้หมด" : "ปกติ"}</strong></div>
        <div><span>จำนวนขาย</span><strong>${money(soldQty)} ${p.unit || ""}</strong></div>
        <div><span>ยอดขายสินค้า</span><strong>${money(soldRevenue)}</strong></div>
        <div><span>กำไรรวม</span><strong class="${productProfit >= 0 ? "positive" : "negative"}">${money(productProfit)}</strong></div>
        <div><span>จำนวนบิล</span><strong>${activeItems.length.toLocaleString("th-TH")}</strong></div>
      </div>
    </div>

    <div class="product-history-grid">
      <div class="panel">
        <div class="panel-head">
          <h3>ประวัติขาย</h3>
          <span class="hint">จากบิลขายที่มีสินค้านี้</span>
        </div>
        <div class="stack-list">
          ${items.slice(0, 30).map(item => `
            <div class="list-item ${item.bill.status === "cancelled" ? "cancelled-row" : "product-move-out"}">
              <div>
                <strong><button class="bill-link" onclick="openBillDetail('${item.bill.id}')">${item.bill.billNo}</button> ${billBadge(item.bill)}</strong>
                <small>${item.bill.date} • ${customerName(item.bill.customerId)} • จำนวน ${money(item.qty)} • ราคา ${money(item.unitPrice)}</small>
              </div>
              <div>
                <div class="money">${money(item.revenue)}</div>
                <small class="${Number(item.profit || 0) >= 0 ? "positive" : "negative"}">กำไร ${money(item.profit)}</small>
              </div>
            </div>
          `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติขาย</strong></div></div>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>ประวัติสต็อก</h3>
          <span class="hint">ซื้อเข้า / ปรับสต็อก / คืนจากยกเลิกบิล</span>
        </div>
        <div class="stack-list">
          ${movements.slice(0, 30).map(m => {
            const isIn = Number(m.qtyIn || 0) > 0;
            const cls = m.type === "sale_cancel" ? "product-move-cancel" : (isIn ? "product-move-in" : "product-move-out");
            const qty = isIn ? m.qtyIn : m.qtyOut;
            return `
              <div class="list-item ${cls}">
                <div>
                  <strong>${m.type}</strong>
                  <small>${m.date} • ${m.note || "-"} • ทุน ${money(m.unitCost || 0)}</small>
                </div>
                <div class="money ${isCost ? "product-profit" : (isIn ? "positive" : "negative")}">${isCost ? "ทุน " + money(m.unitCost || 0) : (isIn ? "+" : "-") + money(qty)}</div>
              </div>
            `;
          }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติสต็อก</strong></div></div>`}
        </div>
      </div>
    </div>
  `;
}

window.openProductDetail = (id) => {
  selectedProductId = id;
  renderProductDetail();
  if (!$("productDetail")) {
    alert("ไม่พบหน้ารายละเอียดสินค้า กรุณาอัปเดต index.html ให้ครบ");
    return;
  }
  switchTab("productDetail");
};

window.quickPurchaseProduct = (id) => {
  $("purchaseProduct").value = id;
  switchTab("purchase");
};

window.quickAdjustProduct = (id) => {
  $("adjustProduct").value = id;
  switchTab("adjust");
};

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
          <button class="small-btn" onclick="openCustomerDetail('${c.id}')">รายละเอียด</button><button class="small-btn" onclick="openLedger('${c.id}')">สมุดบัญชี</button>
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


function customerBills(customerId) {
  return state.bills
    .filter(b => b.customerId === customerId)
    .sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function customerPayments(customerId) {
  return state.payments
    .filter(p => p.customerId === customerId)
    .sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function renderCustomerDetail() {
  const wrap = $("customerDetailContent");
  if (!wrap) return;

  const c = state.customers.find(x => x.id === selectedCustomerDetailId);
  if (!c) {
    wrap.innerHTML = `<div class="panel"><div class="list-item"><div><strong>ยังไม่ได้เลือกลูกค้า</strong><small>ไปที่หน้าลูกค้า แล้วกดปุ่ม “รายละเอียด” หรือ “สมุดบัญชี”</small></div></div></div>`;
    return;
  }

  const bills = customerBills(c.id);
  const activeCustomerBills = bills.filter(b => b.status !== "cancelled");
  const payments = customerPayments(c.id);

  const totalSales = activeCustomerBills.reduce((sum, b) => sum + Number(b.subtotal || 0), 0);
  const totalProfit = activeCustomerBills.reduce((sum, b) => sum + Number(b.profitTotal || 0), 0);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const debt = customerDebt(c.id);

  wrap.innerHTML = `
    <div class="customer-hero">
      <div class="customer-hero-top">
        <div class="customer-title-row">
          <div class="customer-avatar-big">👤</div>
          <div>
            <h3>${c.name}</h3>
            <small>${c.type || "ทั่วไป"} ${c.phone ? "• " + c.phone : ""} ${c.note ? "• " + c.note : ""}</small>
          </div>
        </div>
        <div class="row-actions">
          <button class="soft-btn" onclick="editCustomer('${c.id}')">แก้ไขลูกค้า</button>
          <button class="soft-btn" onclick="openLedger('${c.id}')">สมุดบัญชี</button>
          <button class="primary-btn" onclick="quickPaymentCustomer('${c.id}')">รับเงิน</button>
        </div>
      </div>

      <div class="customer-kpis">
        <div><span>ยอดซื้อรวม</span><strong>${money(totalSales)}</strong></div>
        <div><span>กำไรรวม</span><strong class="${totalProfit >= 0 ? "positive" : "negative"}">${money(totalProfit)}</strong></div>
        <div><span>รับเงินแล้ว</span><strong class="positive">${money(totalPaid)}</strong></div>
        <div><span>ยอดค้าง</span><strong class="${debt > 0 ? "negative" : "positive"}">${money(debt)}</strong></div>
        <div><span>จำนวนบิล</span><strong>${activeCustomerBills.length.toLocaleString("th-TH")}</strong></div>
        <div><span>วงเงินเครดิต</span><strong>${money(c.creditLimit || 0)}</strong></div>
        <div><span>เครดิตกี่วัน</span><strong>${Number(c.creditDays || 0).toLocaleString("th-TH")}</strong></div>
        <div><span>บิลเครดิตค้าง</span><strong>${activeCustomerBills.filter(b => Number(b.creditAmount || 0) > 0).length.toLocaleString("th-TH")}</strong></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>บิลของลูกค้านี้</h3>
        <span class="hint">กดดูบิลเพื่อดูว่าสินค้าในบิลมีอะไรบ้าง</span>
      </div>
      <div class="stack-list">
        ${bills.map(b => `
          <div class="list-item customer-bill-row ${b.status === "cancelled" ? "cancelled" : (Number(b.creditAmount || 0) > 0 ? "credit" : "")}">
            <div>
              <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)}</strong>
              <small>${b.date} • ${billItems(b.id).length} รายการ • ยอดขาย ${money(b.subtotal)} • กำไร ${money(b.profitTotal)}</small>
              ${Number(b.creditAmount || 0) > 0 ? `<small>ยอดค้างบิลนี้: ${money(b.creditAmount)}</small>` : ""}
              ${b.status === "cancelled" && b.cancelReason ? `<small>ยกเลิก: ${b.cancelReason}</small>` : ""}
            </div>
            <div class="row-actions">
              <button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>
              <button class="small-btn" onclick="copyBillText('${b.id}')">คัดลอก</button>
            </div>
          </div>
        `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🧾</div><strong>ยังไม่มีบิลของลูกค้านี้</strong><small>เมื่อขายให้ลูกค้าคนนี้ บิลจะแสดงที่นี่</small></div></div>`}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>ประวัติรับเงิน</h3>
        <span class="hint">รายการรับเงินที่ผูกกับลูกค้านี้</span>
      </div>
      <div class="stack-list">
        ${payments.map(p => {
          const b = state.bills.find(x => x.id === p.billId);
          return `
            <div class="list-item customer-payment-row">
              <div>
                <strong>รับเงิน ${money(p.amount)} บาท</strong>
                <small>${p.date} • ${p.method || "-"} ${b ? "• บิล " + b.billNo : "• ไม่ผูกบิล"} ${p.note ? "• " + p.note : ""}</small>
              </div>
              <div class="row-actions">
                ${b ? `<button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>` : ""}
                <button class="small-btn small-edit" onclick="editPayment('${p.id}')">แก้ไข</button>
              </div>
            </div>
          `;
        }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติรับเงิน</strong><small>เมื่อรับเงินจากลูกค้า รายการจะแสดงที่นี่</small></div></div>`}
      </div>
    </div>
  `;
}

window.openCustomerDetail = (id) => {
  selectedCustomerDetailId = id;
  selectedLedgerCustomerId = id;
  renderCustomerDetail();
  if (!$("customerDetail")) {
    alert("ไม่พบหน้ารายละเอียดลูกค้า กรุณาอัปเดต index.html ให้ครบ");
    return;
  }
  switchTab("customerDetail");
};

window.quickPaymentCustomer = (id) => {
  $("paymentCustomer").value = id;
  renderPaymentBillOptions();
  renderOutstandingBills();
  switchTab("payments");
};

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
  await rebuildCostSnapshots();
  await loadState();
  showToast("ลบรายการซื้อเข้าและคำนวณทุนใหม่แล้ว");
};


function renderAdjustments() {
  const list = $("adjustList");
  if (!list) return;

  const rows = state.stock_movements
    .filter(m => m.type === "adjust_in" || m.type === "adjust_out" || m.type === "cost_adjust")
    .slice(0, 30);

  list.innerHTML = rows.map(m => {
    const isIn = m.type === "adjust_in";
    const isCost = m.type === "cost_adjust";
    const p = productById(m.productId);
    const qty = isCost ? 0 : (isIn ? Number(m.qtyIn || 0) : Number(m.qtyOut || 0));
    return `
      <div class="list-item ${isCost ? "cost-adjust" : (isIn ? "adjust-in" : "adjust-out")}">
        <div>
          <strong>${p?.name || "-"}</strong>
          <small>${m.date} • <span class="adjust-type-badge ${isIn ? "adjust-type-in" : "adjust-type-out"}">${isCost ? "ปรับทุนเฉลี่ย" : (isIn ? "ปรับเพิ่ม" : "ปรับลด")}</span> • ${m.note || "-"}</small>
          <small>ทุนต่อหน่วย: ${money(m.unitCost || 0)}</small>
        </div>
        <div class="row-actions">
          <div class="money ${isCost ? "product-profit" : (isIn ? "positive" : "negative")}">${isCost ? "ทุน " + money(m.unitCost || 0) : (isIn ? "+" : "-") + money(qty)}</div>
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
  const m = state.stock_movements.find(x => x.id === id && (x.type === "adjust_in" || x.type === "adjust_out" || x.type === "cost_adjust"));
  if (!m) return;

  $("adjustId").value = m.id;
  $("adjustDate").value = m.date || today();
  $("adjustProduct").value = m.productId || "";
  $("adjustType").value = m.type;
  $("adjustQty").value = m.type === "cost_adjust" ? "" : (Number(m.qtyIn || 0) > 0 ? m.qtyIn : m.qtyOut);
  $("adjustCost").value = m.unitCost || 0;
  $("adjustNote").value = m.note || "";
  $("adjustSubmitBtn").textContent = "อัปเดตปรับสต็อก";
  $("adjustEditBanner").classList.remove("hidden");
  $("cancelAdjustEditBtn").classList.remove("hidden");
  switchTab("adjust");
};

window.deleteAdjustment = async (id) => {
  const m = state.stock_movements.find(x => x.id === id && (x.type === "adjust_in" || x.type === "adjust_out" || x.type === "cost_adjust"));
  if (!m) return;

  const p = productById(m.productId);
  const qty = Number(m.qtyIn || 0) > 0 ? m.qtyIn : m.qtyOut;
  if (!confirm(`ลบรายการปรับสต็อก?\n\nสินค้า: ${p?.name || "-"}\nจำนวน: ${money(qty)}\nเหตุผล: ${m.note || "-"}\n\nระบบจะคำนวณสต็อกใหม่`)) return;

  await del("stock_movements", id);
  await rebuildCostSnapshots();
  await loadState();
  showToast("ลบรายการปรับสต็อก/ทุนและคำนวณใหม่แล้ว");
};

function renderLedger() {
  const q = ($("ledgerSearch")?.value || "").toLowerCase().trim();
  const rows = state.customers
    .map(c => ({ ...c, debt: customerDebt(c.id) }))
    .filter(c => !q || `${c.name} ${c.phone || ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.debt - a.debt);

  $("ledgerCustomers").innerHTML = rows.map(c => `<div class="list-item" onclick="openCustomerDetail('${c.id}')"><div><strong>${c.name}</strong><small>${c.type || ""}</small></div><div class="money ${c.debt > 0 ? "negative" : "positive"}">${money(c.debt)}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีลูกค้า</strong></div></div>`;

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
    ...bills.map(b => ({ date: b.date, createdAt: b.createdAt || "", title: `บิล ${b.billNo}`, detail: `ขายเครดิต ${billItems(b.id).length} รายการ • ค้าง ${money(b.creditAmount)}`, amount: Number(b.subtotal || 0), type: "sale", billId: b.id })),
    ...payments.map(p => ({ date: p.date, createdAt: p.createdAt || "", title: "รับเงิน", detail: p.method || "", amount: -Number(p.amount || 0), type: "pay" }))
  ].sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));

  $("ledgerEntries").innerHTML = entries.map(e => `<div class="list-item"><div><strong>${e.billId ? `<button class="bill-link" onclick="openBillDetail(\`${e.billId}\`)">${e.title}</button>` : e.title}</strong><small>${e.date} • ${e.detail}</small></div><div class="money ${e.amount > 0 ? "negative" : "positive"}">${e.amount > 0 ? "+" : "-"}${money(Math.abs(e.amount))}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติเครดิต</strong></div></div>`;
}

window.openLedger = (id) => {
  selectedLedgerCustomerId = id;
  renderLedger();
  switchTab("ledger");
};


function creditBillsForCustomer(customerId) {
  if (!customerId) return [];
  return activeBills()
    .filter(b => b.customerId === customerId && b.paymentType === "credit")
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function outstandingBillsForCustomer(customerId) {
  return creditBillsForCustomer(customerId).filter(b => Number(b.creditAmount || 0) > 0);
}

function renderPaymentBillOptions() {
  const select = $("paymentBill");
  if (!select) return;

  const customerId = $("paymentCustomer")?.value || "";
  const currentBill = select.value;
  const rows = creditBillsForCustomer(customerId);

  select.innerHTML = `<option value="">เลือกบิลที่รับเงิน</option>` + rows.map(b => {
    const label = `${b.billNo} • ค้าง ${money(b.creditAmount)} • ${b.date}`;
    return `<option value="${b.id}">${label}</option>`;
  }).join("");

  if ([...select.options].some(o => o.value === currentBill)) select.value = currentBill;
}

function renderOutstandingBills() {
  const list = $("outstandingBills");
  if (!list) return;

  const customerId = $("paymentCustomer")?.value || "";
  if (!customerId) {
    list.innerHTML = `<div class="list-item"><div><strong>เลือกลูกค้าก่อน</strong><small>ระบบจะแสดงบิลเครดิตที่ยังค้างของลูกค้าคนนั้น</small></div></div>`;
    return;
  }

  const rows = outstandingBillsForCustomer(customerId);
  const selectedBillId = $("paymentBill")?.value || "";

  list.innerHTML = rows.map(b => `
    <div class="list-item outstanding-bill ${selectedBillId === b.id ? "selected" : ""}" onclick="selectPaymentBill('${b.id}')">
      <div>
        <strong>${b.billNo} <span class="bill-pay-tag">ค้าง ${money(b.creditAmount)}</span></strong>
        <small>${b.date} • ยอดบิล ${money(b.subtotal)} • รับแล้ว ${money(b.paidAmount)}</small>
      </div>
      <div class="row-actions">
        <button class="small-btn" onclick="event.stopPropagation(); openBillDetail('${b.id}')">ดูบิล</button>
        <button class="small-btn small-edit" onclick="event.stopPropagation(); selectPaymentBill('${b.id}')">เลือก</button>
      </div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ไม่มีบิลค้าง</strong><small>ลูกค้านี้ไม่มีบิลเครดิตที่ยังค้างชำระ</small></div></div>`;
}

window.selectPaymentBill = (billId) => {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return;

  $("paymentBill").value = billId;
  if (!Number($("paymentAmount").value || 0)) {
    $("paymentAmount").value = Number(b.creditAmount || 0);
  }
  renderOutstandingBills();
};

function renderPayments() {
  $("paymentList").innerHTML = state.payments.slice(0, 30).map(p => {
    const b = state.bills.find(x => x.id === p.billId);
    return `
      <div class="list-item payment-linked">
        <div>
          <strong>${customerName(p.customerId)}</strong>
          <small>${p.date} • ${p.method} ${b ? `• บิล ${b.billNo}` : "• ไม่ผูกบิล"} ${p.note ? `• ${p.note}` : ""}</small>
        </div>
        <div class="row-actions">
          <div class="money positive">${money(p.amount)}</div>
          ${b ? `<button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>` : ""}
          <button class="small-btn small-edit" onclick="editPayment('${p.id}')">แก้ไข</button>
          <button class="small-btn small-danger" onclick="deletePayment('${p.id}')">ลบ</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติรับเงิน</strong></div></div>`;
}

function resetPaymentForm() {
  $("paymentId").value = "";
  $("paymentDate").value = today();
  $("paymentCustomer").value = "";
  if ($("paymentBill")) $("paymentBill").value = "";
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
  renderPaymentBillOptions();
  if ($("paymentBill")) $("paymentBill").value = p.billId || "";
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
  await recalcBills();
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
    <td><div class="row-actions"><button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button><button class="small-btn" onclick="copyBillText('${b.id}')">คัดลอกเต็ม</button>${b.status !== "cancelled" ? `<button class="small-btn small-danger" onclick="cancelBill('${b.id}')">ยกเลิก</button>` : ""}</div></td>
  </tr>`).join("") || `<tr><td colspan="7">ไม่พบรายการขาย</td></tr>`;
}






function lowStockProducts() {
  return activeProducts()
    .filter(p => Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0))
    .sort((a, b) => Number(a.stockQty || 0) - Number(b.stockQty || 0));
}

function lowStockStatus(p) {
  return Number(p.stockQty || 0) <= 0 ? "critical" : "low";
}

function lowStockText() {
  const setting = mainSettings();
  const rows = lowStockProducts();
  const lines = [
    `${setting.shopName || "Khaikhong"} - สินค้าใกล้หมด`,
    `วันที่: ${today()}`,
    `จำนวน: ${rows.length} รายการ`,
    "------------------------------"
  ];

  if (!rows.length) {
    lines.push("ไม่มีสินค้าใกล้หมด");
  } else {
    rows.forEach(p => {
      lines.push(`${p.name} | เหลือ ${money(p.stockQty)} ${p.unit || ""} | ขั้นต่ำ ${money(p.minStock)} | ปลีก ${money(p.price)} / ส่ง ${money(productWholesalePrice(p))}`);
    });
  }

  return lines.join("\n");
}

function renderLowStockCenter() {
  const rows = lowStockProducts();

  if ($("lowStockCountText")) $("lowStockCountText").textContent = rows.length ? `พบ ${rows.length} รายการ` : "ไม่มีสินค้าใกล้หมด";

  const html = rows.map(p => {
    const status = lowStockStatus(p);
    return `
      <div class="list-item low-stock-item ${status}">
        <div>
          <strong>${p.name} <span class="stock-pill ${status}">${status === "critical" ? "หมด/ติดศูนย์" : "ใกล้หมด"}</span></strong>
          <small>เหลือ ${money(p.stockQty)} ${p.unit || ""} • ขั้นต่ำ ${money(p.minStock)} • ทุนเฉลี่ย ${money(p.avgCost)} • ปลีก ${money(p.price)} / ส่ง ${money(productWholesalePrice(p))}</small>
        </div>
        <div class="row-actions">
          <button class="small-btn" onclick="openProductDetail('${p.id}')">รายละเอียด</button>
          <button class="small-btn small-edit" onclick="quickPurchaseProduct('${p.id}')">ซื้อเข้า</button>
          <button class="small-btn" onclick="quickAdjustProduct('${p.id}')">ปรับสต็อก</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item"><div><strong>ไม่มีสินค้าใกล้หมด</strong><small>ระบบจะแสดงเมื่อสต็อกเหลือน้อยกว่าหรือเท่ากับขั้นต่ำ</small></div></div>`;

  if ($("lowStockCenterList")) $("lowStockCenterList").innerHTML = html;
  if ($("lowStockMiniList")) $("lowStockMiniList").innerHTML = rows.slice(0, 3).map(p => `
    <div class="list-item low-stock-item ${lowStockStatus(p)}">
      <div>
        <strong>${p.name}</strong>
        <small>เหลือ ${money(p.stockQty)} ${p.unit || ""} / ขั้นต่ำ ${money(p.minStock)}</small>
      </div>
      <button class="small-btn small-edit" onclick="quickPurchaseProduct('${p.id}')">ซื้อเข้า</button>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ไม่มีสินค้าใกล้หมด</strong></div></div>`;
}

async function copyLowStockList() {
  const text = lowStockText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกรายการสินค้าใกล้หมดแล้ว");
  } catch {
    prompt("คัดลอกรายการสินค้าใกล้หมด:", text);
  }
}

function printLowStockList() {
  const rows = lowStockProducts();
  const setting = mainSettings();
  $("printArea").innerHTML = `
    <div class="print-lowstock">
      <h1>${setting.shopName || "Khaikhong"} - สินค้าใกล้หมด</h1>
      <div class="muted">วันที่ ${today()} • ${rows.length} รายการ</div>
      <table>
        <thead><tr><th>สินค้า</th><th class="right">เหลือ</th><th class="right">ขั้นต่ำ</th><th class="right">ราคาขาย</th></tr></thead>
        <tbody>
          ${rows.map(p => `<tr><td>${p.name}</td><td class="right">${money(p.stockQty)} ${p.unit || ""}</td><td class="right">${money(p.minStock)}</td><td class="right">${money(p.price)}</td></tr>`).join("") || `<tr><td colspan="4">ไม่มีสินค้าใกล้หมด</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  window.print();
}

function dailyCloseStats(dateText = today()) {
  const billsToday = activeBills().filter(b => String(b.date || "") === dateText);
  const paymentsToday = state.payments.filter(p => String(p.date || "") === dateText);

  const sales = billsToday.reduce((sum, b) => sum + Number(b.subtotal || 0), 0);
  const cost = billsToday.reduce((sum, b) => sum + Number(b.costTotal || 0), 0);
  const profit = billsToday.reduce((sum, b) => sum + Number(b.profitTotal || 0), 0);

  const cashPaidFromBills = billsToday.reduce((sum, b) => sum + Number(b.initialPaidAmount ?? b.paidAmount ?? 0), 0);
  const creditNew = billsToday.reduce((sum, b) => sum + Number(b.creditAmount || 0), 0);
  const paymentsReceived = paymentsToday.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    date: dateText,
    bills: billsToday,
    payments: paymentsToday,
    sales,
    cost,
    profit,
    cashPaidFromBills,
    creditNew,
    paymentsReceived,
    billCount: billsToday.length
  };
}

function renderDailyClose() {
  if (!$("closeSalesToday")) return;

  const s = dailyCloseStats();
  $("closeSalesToday").textContent = money(s.sales);
  $("closeProfitToday").textContent = money(s.profit);
  $("closeCashToday").textContent = money(s.cashPaidFromBills);
  $("closeCreditToday").textContent = money(s.creditNew);
  $("closePaymentToday").textContent = money(s.paymentsReceived);
  $("closeBillCountToday").textContent = s.billCount.toLocaleString("th-TH");
}

function dailyCloseText(dateText = today()) {
  const s = dailyCloseStats(dateText);
  const setting = mainSettings();

  return [
    `${setting.shopName || "Khaikhong"} - สรุปปิดยอด`,
    `วันที่: ${s.date}`,
    "------------------------------",
    `จำนวนบิล: ${s.billCount}`,
    `ยอดขายวันนี้: ${money(s.sales)} บาท`,
    `ต้นทุนวันนี้: ${money(s.cost)} บาท`,
    `กำไรวันนี้: ${money(s.profit)} บาท`,
    `เงินสด/โอนจากบิลวันนี้: ${money(s.cashPaidFromBills)} บาท`,
    `เครดิตใหม่วันนี้: ${money(s.creditNew)} บาท`,
    `รับเงินลูกหนี้วันนี้: ${money(s.paymentsReceived)} บาท`,
    "------------------------------",
    `Backup ล่าสุด: ${localStorage.getItem("khaikhongV2LastBackup") ? new Date(localStorage.getItem("khaikhongV2LastBackup")).toLocaleString("th-TH") : "ยังไม่เคย"}`
  ].join("\n");
}

async function copyDailyClose() {
  const text = dailyCloseText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกสรุปปิดยอดแล้ว");
  } catch {
    prompt("คัดลอกสรุปปิดยอด:", text);
  }
}

function printDailyClose() {
  const s = dailyCloseStats();
  const setting = mainSettings();

  $("printArea").innerHTML = `
    <div class="print-close">
      <h1>${setting.shopName || "Khaikhong"} - สรุปปิดยอด</h1>
      <div class="muted">วันที่ ${s.date}</div>
      <div class="line"><span>จำนวนบิล</span><strong>${s.billCount}</strong></div>
      <div class="line"><span>ยอดขายวันนี้</span><strong>${money(s.sales)}</strong></div>
      <div class="line"><span>ต้นทุนวันนี้</span><strong>${money(s.cost)}</strong></div>
      <div class="line total"><span>กำไรวันนี้</span><strong>${money(s.profit)}</strong></div>
      <div class="line"><span>เงินสด/โอนจากบิลวันนี้</span><strong>${money(s.cashPaidFromBills)}</strong></div>
      <div class="line"><span>เครดิตใหม่วันนี้</span><strong>${money(s.creditNew)}</strong></div>
      <div class="line"><span>รับเงินลูกหนี้วันนี้</span><strong>${money(s.paymentsReceived)}</strong></div>
      <div class="muted" style="margin-top:14px">พิมพ์จาก Khaikhong</div>
    </div>
  `;

  window.print();
}

function receiptStatusText(b) {
  if (b.status === "cancelled") return "ยกเลิก";
  if (Number(b.creditAmount || 0) > 0) return "เครดิต/ค้างชำระ";
  return "ชำระแล้ว";
}

function receiptStatusClass(b) {
  if (b.status === "cancelled") return "cancelled";
  if (Number(b.creditAmount || 0) > 0) return "credit";
  return "paid";
}

function receiptTextForBill(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return "";

  const s = mainSettings();
  const items = billItems(b.id);
  const lines = [];
  lines.push(s.shopName || "Khaikhong");
  lines.push(`บิล: ${b.billNo}`);
  lines.push(`วันที่: ${b.date}`);
  lines.push(`ลูกค้า: ${customerName(b.customerId)}`);
  lines.push(`สถานะ: ${receiptStatusText(b)}`);
  lines.push("--------------------------------");

  items.forEach(item => {
    lines.push(`${item.productNameSnapshot || productById(item.productId)?.name || "-"} x ${money(item.qty)} = ${money(item.revenue)} บาท`);
  });

  lines.push("--------------------------------");
  lines.push(`ยอดรวม: ${money(b.subtotal)} บาท`);
  lines.push(`รับเงินแล้ว: ${money(b.paidAmount)} บาท`);
  if (Number(b.creditAmount || 0) > 0) lines.push(`ยอดค้าง: ${money(b.creditAmount)} บาท`);
  if (b.note) lines.push(`หมายเหตุ: ${b.note}`);
  if (b.status === "cancelled") lines.push(`เหตุผลยกเลิก: ${b.cancelReason || "-"}`);
  lines.push("ขอบคุณครับ/ค่ะ");

  return lines.join("\n");
}


function shortReceiptTextForBill(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return "";

  const s = mainSettings();
  const items = billItems(b.id);
  const itemText = items.map(item => `${item.productNameSnapshot || productById(item.productId)?.name || "-"} x${money(item.qty)}`).join(", ");

  return [
    `${s.shopName || "Khaikhong"} | ${b.billNo}`,
    `${b.date} | ${customerName(b.customerId)}`,
    itemText,
    `ยอดรวม ${money(b.subtotal)} บาท`,
    Number(b.creditAmount || 0) > 0 ? `ค้าง ${money(b.creditAmount)} บาท` : `ชำระแล้ว`,
    b.status === "cancelled" ? `ยกเลิก: ${b.cancelReason || "-"}` : ""
  ].filter(Boolean).join("\n");
}

async function copyShortBillText(billId) {
  const text = shortReceiptTextForBill(billId);
  if (!text) return alert("ไม่พบบิล");

  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกบิลแบบสั้นแล้ว");
  } catch {
    prompt("คัดลอกข้อความบิลแบบสั้น:", text);
  }
}

async function shareBill(billId) {
  const text = receiptTextForBill(billId);
  const b = state.bills.find(x => x.id === billId);
  if (!text || !b) return alert("ไม่พบบิล");

  if (navigator.share) {
    try {
      await navigator.share({
        title: `บิล ${b.billNo}`,
        text
      });
      showToast("แชร์บิลแล้ว");
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  await copyBillText(billId);
  alert("อุปกรณ์นี้ไม่รองรับปุ่มแชร์โดยตรง ระบบคัดลอกข้อความบิลให้แล้ว");
}

async function copyBillText(billId) {
  const text = receiptTextForBill(billId);
  if (!text) return alert("ไม่พบบิล");

  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกข้อความบิลแล้ว");
  } catch {
    prompt("คัดลอกข้อความบิล:", text);
  }
}

function renderReceiptHtml(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return "";

  const s = mainSettings();
  const items = billItems(b.id);
  const statusText = receiptStatusText(b);
  const statusClass = receiptStatusClass(b);

  return `
    <div class="receipt-box">
      <div class="receipt-head">
        <div>
          <h3>${s.shopName || "Khaikhong"}</h3>
          <small>${s.subtitle || "ขายง่าย • รู้กำไร • ไม่ลืมลูกหนี้ • คุมสต็อก"}</small>
          <div style="margin-top:8px"><span class="receipt-status ${statusClass}">${statusText}</span></div>
        </div>
        <div>
          <strong>${b.billNo}</strong><br>
          <small>${b.date}</small>
        </div>
      </div>

      <div class="receipt-lines">
        ${items.map(item => `
          <div class="receipt-row">
            <div>
              <strong>${item.productNameSnapshot || productById(item.productId)?.name || "-"}</strong>
              <small>จำนวน ${money(item.qty)} × ${money(item.unitPrice)}</small>
            </div>
            <div class="money">${money(item.revenue)}</div>
          </div>
        `).join("")}
      </div>

      <div class="receipt-total">
        <div><span>ลูกค้า</span><span>${customerName(b.customerId)}</span></div>
        <div><span>รับเงินแล้ว</span><span class="paid-amount">${money(b.paidAmount)}</span></div>
        ${Number(b.creditAmount || 0) > 0 ? `<div><span>ยอดค้าง</span><span class="credit-due">${money(b.creditAmount)}</span></div>` : ""}
        <div class="grand"><span>ยอดรวม</span><span>${money(b.subtotal)} บาท</span></div>
      </div>

      ${b.status === "cancelled" ? `<div class="receipt-cancel-note">บิลนี้ถูกยกเลิกแล้ว<br>เหตุผล: ${b.cancelReason || "-"}<br>เวลายกเลิก: ${b.cancelledAt ? new Date(b.cancelledAt).toLocaleString("th-TH") : "-"}</div>` : ""}

      <div class="receipt-actions">
        <button class="soft-btn" onclick="copyBillText('${b.id}')">คัดลอกเต็ม</button>
        <button class="soft-btn" onclick="copyShortBillText('${b.id}')">คัดลอกสั้น</button>
        <button class="soft-btn" onclick="shareBill('${b.id}')">แชร์บิล</button>
        <button class="soft-btn" onclick="printBill('${b.id}')">พิมพ์บิล</button>
      </div>
    </div>
  `;
}

function printBill(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return alert("ไม่พบบิล");

  const s = mainSettings();
  const items = billItems(b.id);
  const rows = items.map(item => `
    <tr>
      <td>${item.productNameSnapshot || productById(item.productId)?.name || "-"}</td>
      <td class="right">${money(item.qty)}</td>
      <td class="right">${money(item.revenue)}</td>
    </tr>
  `).join("");

  $("printArea").innerHTML = `
    <div class="print-receipt">
      <h1>${s.shopName || "Khaikhong"}</h1>
      <div class="muted">${s.subtitle || ""}</div>
      <div class="muted">บิล: ${b.billNo} • วันที่: ${b.date}</div>
      <div class="muted">ลูกค้า: ${customerName(b.customerId)}</div>
      <div class="status">สถานะ: ${receiptStatusText(b)}</div>

      <table>
        <thead>
          <tr><th>สินค้า</th><th class="right">จำนวน</th><th class="right">รวม</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="2" class="total">ยอดรวม</td><td class="right total">${money(b.subtotal)}</td></tr>
          <tr><td colspan="2">รับเงินแล้ว</td><td class="right">${money(b.paidAmount)}</td></tr>
          ${Number(b.creditAmount || 0) > 0 ? `<tr><td colspan="2">ยอดค้าง</td><td class="right">${money(b.creditAmount)}</td></tr>` : ""}
        </tfoot>
      </table>
      ${b.status === "cancelled" ? `<p class="muted">เหตุผลยกเลิก: ${b.cancelReason || "-"}</p>` : ""}
      <p class="thanks">ขอบคุณครับ/ค่ะ</p>
    </div>
  `;

  window.print();
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
          <button class="soft-btn" onclick="copyBillText('${b.id}')">คัดลอกเต็ม</button>
          <button class="soft-btn" onclick="copyShortBillText('${b.id}')">คัดลอกสั้น</button>
          <button class="soft-btn" onclick="shareBill('${b.id}')">แชร์บิล</button>
          <button class="soft-btn" onclick="printBill('${b.id}')">พิมพ์บิล</button>
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
      <div class="panel-head">
        <h3>ใบเสร็จ / ข้อความบิล</h3>
        <span class="hint">ใช้คัดลอกส่งแชทหรือพิมพ์บิล</span>
      </div>
      ${renderReceiptHtml(b.id)}
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
  const page = $("billDetail");
  if (!page) {
    alert("ไม่พบหน้ารายละเอียดบิล กรุณาอัปเดตไฟล์ index.html ให้ครบ");
    return;
  }
  switchTab("billDetail");
};


function renderSettingsUI() {
  const s = mainSettings();

  if ($("appTitleText")) $("appTitleText").textContent = s.shopName || "Khaikhong";
  if ($("appSubtitleText")) $("appSubtitleText").textContent = s.subtitle || "ขายง่าย • รู้กำไร • ไม่ลืมลูกหนี้ • คุมสต็อก";
  document.title = s.shopName || "Khaikhong";

  if (!$("settingsForm")) return;

  $("settingShopName").value = s.shopName || "Khaikhong";
  $("settingSubtitle").value = s.subtitle || "ขายง่าย • รู้กำไร • ไม่ลืมลูกหนี้ • คุมสต็อก";
  $("settingBillPrefix").value = s.billPrefix || "KH";
  $("settingNextBillNo").value = Number(s.nextBillNo || 1);
  $("settingUseNumberPad").checked = s.useNumberPad !== false;
  updateSettingsPreview();
}

function updateSettingsPreview() {
  if (!$("settingBillPreview")) return;
  $("settingBillPreview").textContent = formatBillNo($("settingBillPrefix").value || "KH", $("settingNextBillNo").value || 1);
}

function renderBackupStatus() {
  const t = localStorage.getItem("khaikhongV2LastBackup");
  const text = t ? new Date(t).toLocaleString("th-TH") : "ยังไม่เคย";
  if ($("backupStatus")) $("backupStatus").textContent = `Backup: ${text}`;
  if ($("backupStatusLarge")) $("backupStatusLarge").textContent = text;

  const advice = $("backupAdvice");
  if (advice) {
    advice.classList.remove("ok");
    if (!t) {
      advice.textContent = "ยังไม่เคย Backup ข้อมูล ควร Export Backup ก่อนใช้งานจริงหรือก่อนอัปเดตระบบ";
    } else {
      const last = new Date(t).getTime();
      const ageHours = (Date.now() - last) / 36e5;
      if (ageHours > 24) {
        advice.textContent = `Backup ล่าสุดเกิน 24 ชั่วโมงแล้ว แนะนำให้ Export Backup ใหม่`;
      } else {
        advice.textContent = `Backup ล่าสุดยังใหม่อยู่ แต่ควร Backup อีกครั้งหลังเพิ่มข้อมูลสำคัญ`;
        advice.classList.add("ok");
      }
    }
  }
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
$("billCustomer").addEventListener("change", refreshCartPricesForCustomer);

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
    wholesalePrice: Number($("productWholesalePrice")?.value || $("productPrice").value || 0),
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
  await rebuildCostSnapshots();
  await loadState();
  showToast(editId ? "อัปเดตซื้อเข้าและคำนวณทุนใหม่แล้ว" : "บันทึกซื้อเข้าแล้ว");
});

$("cancelPurchaseEditBtn").addEventListener("click", resetPurchaseForm);

$("paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const customerId = $("paymentCustomer").value;
  const billId = $("paymentBill") ? $("paymentBill").value : "";
  const amount = Number($("paymentAmount").value || 0);
  const editId = $("paymentId").value;

  if (!customerId) return alert("กรุณาเลือกลูกค้า");
  if (!billId) return alert("กรุณาเลือกบิลที่รับเงิน");
  if (amount <= 0) return alert("กรุณาใส่จำนวนเงิน");

  const bill = state.bills.find(b => b.id === billId);
  const old = editId ? state.payments.find(p => p.id === editId) : null;
  const oldAmountSameBill = old && old.billId === billId ? Number(old.amount || 0) : 0;
  const maxPay = Number(bill?.creditAmount || 0) + oldAmountSameBill;

  if (amount > maxPay) {
    return alert(`รับเงินมากกว่ายอดค้างไม่ได้\nยอดค้างที่รับได้: ${money(maxPay)} บาท`);
  }

  await put("payments", {
    ...(old || {}),
    id: editId || uid(),
    customerId,
    billId,
    date: $("paymentDate").value || today(),
    amount,
    method: $("paymentMethod").value,
    note: $("paymentNote").value.trim(),
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await recalcBills();
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
    if (type !== "cost_adjust" && qty <= 0) return alert("กรุณาใส่จำนวน");
    if (!note && !confirm("ยังไม่ได้ใส่เหตุผล ต้องการบันทึกต่อไหม?")) return;

    if (type === "adjust_out") {
      const p = productById(productId);
      const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
      const oldQtySameProduct = old && old.productId === productId && old.type === "adjust_out" ? Number(old.qtyOut || 0) : 0;
      const available = Number(p?.stockQty || 0) + oldQtySameProduct;
      if (qty > available) return alert(`สต็อกไม่พอ เหลือ ${money(available)} ${p?.unit || ""}`);
    }

    if ((type === "adjust_in" || type === "cost_adjust") && cost <= 0 && !confirm("ทุนต่อหน่วยเป็น 0 ต้องการบันทึกต่อไหม?")) return;

    const old = editId ? state.stock_movements.find(m => m.id === editId) : null;
    await put("stock_movements", {
      ...(old || {}),
      id: editId || uid(),
      productId,
      type,
      refType: type === "cost_adjust" ? "cost" : "adjust",
      refId: "",
      date: $("adjustDate").value || today(),
      qtyIn: type === "adjust_in" ? qty : 0,
      qtyOut: type === "adjust_out" ? qty : 0,
      unitCost: (type === "adjust_in" || type === "cost_adjust") ? cost : Number(old?.unitCost || productById(productId)?.avgCost || 0),
      note,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    resetAdjustForm();
    await rebuildCostSnapshots();
    await loadState();
    showToast(editId ? "อัปเดตปรับสต็อก/ทุนแล้ว" : "บันทึกปรับสต็อก/ทุนแล้ว");
  });

  $("cancelAdjustEditBtn").addEventListener("click", resetAdjustForm);
}


$("paymentCustomer").addEventListener("change", () => {
  if ($("paymentBill")) $("paymentBill").value = "";
  $("paymentAmount").value = "";
  renderPaymentBillOptions();
  renderOutstandingBills();
});
if ($("paymentBill")) if ($("paymentBill")) $("paymentBill").addEventListener("change", () => {
  const b = state.bills.find(x => x.id === $("paymentBill").value);
  if (b && !Number($("paymentAmount").value || 0)) $("paymentAmount").value = Number(b.creditAmount || 0);
  renderOutstandingBills();
});

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


$("paymentCustomer").addEventListener("change", () => {
  if ($("paymentBill")) $("paymentBill").value = "";
  $("paymentAmount").value = "";
  renderPaymentBillOptions();
  renderOutstandingBills();
});
if ($("paymentBill")) if ($("paymentBill")) $("paymentBill").addEventListener("change", () => {
  const b = state.bills.find(x => x.id === $("paymentBill").value);
  if (b && !Number($("paymentAmount").value || 0)) $("paymentAmount").value = Number(b.creditAmount || 0);
  renderOutstandingBills();
});

["reportFrom", "reportTo", "reportCustomer", "reportPaymentType"].forEach(id => $(id).value = "");
  renderReports();
});


function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text) {
  const cleaned = text.replace(/^\ufeff/, "").replace(/\r/g, "");
  const lines = cleaned.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ?? "");
    return row;
  });
}

function getCsvValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
  }
  return "";
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function makeCsv(rows) {
  return "\ufeff" + rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

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
  const data = { app: "Khaikhong", version: "2.2.4", exportedAt: new Date().toISOString(), ...state };
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
  if (e.target?.matches?.('input[data-keypad="true"]') && isNumberPadEnabled()) {
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


$("downloadProductTemplateBtn")?.addEventListener("click", () => {
  const csv = makeCsv([
    ["ชื่อสินค้า", "หน่วย", "ราคาขายปลีก", "ราคาขายส่ง", "สต็อกขั้นต่ำ", "หมายเหตุ"],
    ["ปูอัด", "แพ็ค", "100", "90", "2", "ตัวอย่างสินค้า"],
    ["ลูกชิ้น", "ถุง", "80", "70", "5", ""]
  ]);
  download("khaikhong-products-template.csv", csv, "text/csv;charset=utf-8");
});

$("downloadCustomerTemplateBtn")?.addEventListener("click", () => {
  const csv = makeCsv([
    ["ชื่อลูกค้า", "ประเภท", "เบอร์โทร", "วงเงินเครดิต", "เครดิตกี่วัน", "หมายเหตุ"],
    ["แนน", "ขายส่ง", "0812345678", "3000", "7", "ตัวอย่างลูกค้า"],
    ["ลูกค้าเงินสด", "ทั่วไป", "", "0", "0", ""]
  ]);
  download("khaikhong-customers-template.csv", csv, "text/csv;charset=utf-8");
});

$("importProductsCsvInput")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const rows = parseCsv(await file.text());
  const valid = rows
    .map(row => ({
      name: getCsvValue(row, ["ชื่อสินค้า", "name", "สินค้า"]).trim(),
      unit: getCsvValue(row, ["หน่วย", "unit"]).trim(),
      price: Number(getCsvValue(row, ["ราคาขายปลีก", "ราคาขาย", "price", "ขาย"]) || 0),
      wholesalePrice: Number(getCsvValue(row, ["ราคาขายส่ง", "wholesalePrice", "ส่ง"]) || getCsvValue(row, ["ราคาขายปลีก", "ราคาขาย", "price", "ขาย"]) || 0),
      minStock: Number(getCsvValue(row, ["สต็อกขั้นต่ำ", "minStock", "ขั้นต่ำ"]) || 0),
      note: getCsvValue(row, ["หมายเหตุ", "note"]).trim()
    }))
    .filter(row => row.name);

  if (!valid.length) {
    alert("ไม่พบข้อมูลสินค้าใน CSV");
    e.target.value = "";
    return;
  }

  if (!confirm(`นำเข้าสินค้า ${valid.length} รายการ?\n\nระบบจะเพิ่มสินค้าใหม่ ถ้าชื่อซ้ำจะอัปเดตราคา/หน่วย/ขั้นต่ำ`)) {
    e.target.value = "";
    return;
  }

  for (const row of valid) {
    const existing = state.products.find(p => !p.isArchived && (p.name || "").trim() === row.name);
    await put("products", {
      ...(existing || {}),
      id: existing?.id || uid(),
      name: row.name,
      unit: row.unit,
      price: row.price,
      wholesalePrice: row.wholesalePrice,
      minStock: row.minStock,
      note: row.note,
      stockQty: Number(existing?.stockQty || 0),
      avgCost: Number(existing?.avgCost || 0),
      isArchived: false,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await loadState();
  showToast(`นำเข้าสินค้า ${valid.length} รายการแล้ว`);
  e.target.value = "";
});

$("importCustomersCsvInput")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const rows = parseCsv(await file.text());
  const valid = rows
    .map(row => ({
      name: getCsvValue(row, ["ชื่อลูกค้า", "name", "ลูกค้า"]).trim(),
      type: getCsvValue(row, ["ประเภท", "type"]).trim() || "ทั่วไป",
      phone: getCsvValue(row, ["เบอร์โทร", "phone", "โทร"]).trim(),
      creditLimit: Number(getCsvValue(row, ["วงเงินเครดิต", "creditLimit", "วงเงิน"]) || 0),
      creditDays: Number(getCsvValue(row, ["เครดิตกี่วัน", "creditDays", "เครดิตวัน"]) || 0),
      note: getCsvValue(row, ["หมายเหตุ", "note"]).trim()
    }))
    .filter(row => row.name);

  if (!valid.length) {
    alert("ไม่พบข้อมูลลูกค้าใน CSV");
    e.target.value = "";
    return;
  }

  if (!confirm(`นำเข้าลูกค้า ${valid.length} รายการ?\n\nระบบจะเพิ่มลูกค้าใหม่ ถ้าชื่อซ้ำจะอัปเดตข้อมูล`)) {
    e.target.value = "";
    return;
  }

  for (const row of valid) {
    const existing = state.customers.find(c => (c.name || "").trim() === row.name);
    await put("customers", {
      ...(existing || {}),
      id: existing?.id || uid(),
      name: row.name,
      type: row.type,
      phone: row.phone,
      creditLimit: row.creditLimit,
      creditDays: row.creditDays,
      note: row.note,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await loadState();
  showToast(`นำเข้าลูกค้า ${valid.length} รายการแล้ว`);
  e.target.value = "";
});


["settingBillPrefix", "settingNextBillNo"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", updateSettingsPreview);
});

if ($("settingsForm")) {
  $("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const old = mainSettings();
    const nextNo = Math.max(1, Number($("settingNextBillNo").value || 1));
    const billPrefix = ($("settingBillPrefix").value || "KH").trim() || "KH";

    await put("settings", {
      ...old,
      id: "main",
      shopName: ($("settingShopName").value || "Khaikhong").trim() || "Khaikhong",
      subtitle: ($("settingSubtitle").value || "ขายง่าย • รู้กำไร • ไม่ลืมลูกหนี้ • คุมสต็อก").trim(),
      billPrefix,
      nextBillNo: nextNo,
      useNumberPad: $("settingUseNumberPad").checked,
      updatedAt: new Date().toISOString()
    });

    await loadState();
    showToast("บันทึกตั้งค่าแล้ว");
  });
}

if ($("resetSettingsBtn")) $("resetSettingsBtn").addEventListener("click", renderSettingsUI);



async function repairAllCosts() {
  if (!confirm("ตรวจ/ซ่อมทุนและกำไรทั้งหมด?\n\nระบบจะคำนวณต้นทุนขายจากประวัติซื้อเข้า/ปรับทุนใหม่ และอัปเดตกำไรของบิลทั้งหมด")) return;
  await rebuildCostSnapshots();
  await loadState();
  showToast("ตรวจ/ซ่อมทุนเรียบร้อยแล้ว");
  if ($("testResults")) {
    showTestResults([{ status: "info", title: "ตรวจ/ซ่อมทุนเรียบร้อย", detail: "ระบบคำนวณต้นทุนขาย กำไรบิล สต็อก และทุนเฉลี่ยใหม่แล้ว" }, ...runSystemChecks()]);
  }
}

function isTestProduct(p) {
  return (p.name || "").startsWith("TEST-") || (p.note || "").includes("TEST-AUTO");
}
function isTestCustomer(c) {
  return (c.name || "").startsWith("TEST-") || (c.note || "").includes("TEST-AUTO");
}
function isTestBill(b) {
  return (b.note || "").includes("TEST-AUTO") || String(b.billNo || "").includes("TEST");
}
function isTestPayment(p) {
  return (p.note || "").includes("TEST-AUTO");
}
function isTestMovement(m) {
  return (m.note || "").includes("TEST-AUTO") || String(m.note || "").startsWith("TEST-");
}

function renderTestSummary() {
  if (!$("testSummaryText")) return;
  const count =
    state.products.filter(isTestProduct).length +
    state.customers.filter(isTestCustomer).length +
    state.bills.filter(isTestBill).length +
    state.payments.filter(isTestPayment).length +
    state.stock_movements.filter(isTestMovement).length;
  $("testSummaryText").textContent = count ? `พบข้อมูล TEST ${count} รายการ` : "ยังไม่มีข้อมูล TEST";
}

function testResult(status, title, detail = "") {
  const cls = status === "pass" ? "test-result-pass" : (status === "fail" ? "test-result-fail" : "test-result-info");
  const icon = status === "pass" ? "✅" : (status === "fail" ? "❌" : "ℹ️");
  return `<div class="list-item ${cls}"><div><strong>${icon} ${title}</strong>${detail ? `<small>${detail}</small>` : ""}</div></div>`;
}

function showTestResults(results) {
  const pass = results.filter(r => r.status === "pass").length;
  const fail = results.filter(r => r.status === "fail").length;
  const info = results.filter(r => r.status === "info").length;
  $("testSummaryText").textContent = `ผ่าน ${pass} / ไม่ผ่าน ${fail} / ข้อมูล ${info}`;
  $("testResults").innerHTML = results.map(r => testResult(r.status, r.title, r.detail)).join("");
}

function assertNear(actual, expected, tolerance = 0.01) {
  return Math.abs(Number(actual || 0) - Number(expected || 0)) <= tolerance;
}

function calculateProductStockFromMovements(productId) {
  return state.stock_movements
    .filter(m => m.productId === productId)
    .reduce((sum, m) => sum + Number(m.qtyIn || 0) - Number(m.qtyOut || 0), 0);
}

function calculateBillTotals(billId) {
  const items = billItems(billId);
  return {
    subtotal: items.reduce((s, i) => s + Number(i.revenue || 0), 0),
    costTotal: items.reduce((s, i) => s + Number(i.cost || 0), 0),
    profitTotal: items.reduce((s, i) => s + Number(i.profit || 0), 0),
    count: items.length
  };
}

async function ensureTestProduct({ name, unit, price, minStock, note }) {
  const existing = state.products.find(p => (p.name || "") === name);
  if (existing) return existing;

  const item = {
    id: uid(),
    name,
    unit,
    price,
    wholesalePrice: price,
    minStock,
    note,
    stockQty: 0,
    avgCost: 0,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await put("products", item);
  return item;
}

async function ensureTestCustomer() {
  const existing = state.customers.find(c => (c.name || "") === "TEST-ลูกค้าเครดิต");
  if (existing) return existing;

  const item = {
    id: uid(),
    name: "TEST-ลูกค้าเครดิต",
    type: "ทดสอบ",
    phone: "0000000000",
    creditLimit: 9999,
    creditDays: 7,
    note: "TEST-AUTO",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await put("customers", item);
  return item;
}

async function createAutoTestData() {
  await clearTestData(false);
  await loadState();

  const productA = await ensureTestProduct({
    name: "TEST-สินค้า A",
    unit: "ชิ้น",
    price: 25,
    minStock: 2,
    note: "TEST-AUTO"
  });
  const productB = await ensureTestProduct({
    name: "TEST-สินค้า B",
    unit: "ชิ้น",
    price: 40,
    minStock: 2,
    note: "TEST-AUTO"
  });
  const customer = await ensureTestCustomer();

  const date = today();
  const now = new Date().toISOString();

  // ซื้อเข้า
  await put("stock_movements", {
    id: uid(), productId: productA.id, type: "purchase", refType: "purchase", refId: "", date,
    qtyIn: 10, qtyOut: 0, unitCost: 10, note: "TEST-AUTO ซื้อเข้า A", createdAt: now
  });
  await put("stock_movements", {
    id: uid(), productId: productB.id, type: "purchase", refType: "purchase", refId: "", date,
    qtyIn: 8, qtyOut: 0, unitCost: 20, note: "TEST-AUTO ซื้อเข้า B", createdAt: now
  });

  await recomputeInventory();
  await loadState();

  const freshA = state.products.find(p => p.name === "TEST-สินค้า A");
  const freshB = state.products.find(p => p.name === "TEST-สินค้า B");

  // ขายเงินสด
  const billCashId = uid();
  const billCashNo = "TEST-CASH-001";
  const cashItems = [
    { product: freshA, qty: 2, unitPrice: 25, unitCost: Number(freshA.avgCost || 10) },
    { product: freshB, qty: 1, unitPrice: 40, unitCost: Number(freshB.avgCost || 20) }
  ];
  const cashSubtotal = cashItems.reduce((s, x) => s + x.qty * x.unitPrice, 0);
  const cashCost = cashItems.reduce((s, x) => s + x.qty * x.unitCost, 0);
  await put("bills", {
    id: billCashId, billNo: billCashNo, date, customerId: "", paymentType: "cash",
    subtotal: cashSubtotal, costTotal: cashCost, profitTotal: cashSubtotal - cashCost,
    paidAmount: cashSubtotal, initialPaidAmount: cashSubtotal, creditAmount: 0, status: "paid",
    note: "TEST-AUTO ขายเงินสด", createdAt: now
  });
  for (const item of cashItems) {
    await put("bill_items", {
      id: uid(), billId: billCashId, productId: item.product.id, productNameSnapshot: item.product.name,
      qty: item.qty, unitPrice: item.unitPrice, unitCost: item.unitCost,
      revenue: item.qty * item.unitPrice, cost: item.qty * item.unitCost, profit: item.qty * (item.unitPrice - item.unitCost)
    });
    await put("stock_movements", {
      id: uid(), productId: item.product.id, type: "sale", refType: "bill", refId: billCashId, date,
      qtyIn: 0, qtyOut: item.qty, unitCost: item.unitCost, note: `TEST-AUTO ขายบิล ${billCashNo}`, createdAt: now
    });
  }

  // ขายเครดิต
  const billCreditId = uid();
  const billCreditNo = "TEST-CREDIT-001";
  const creditQty = 3;
  const creditUnitPrice = 25;
  const creditUnitCost = Number(freshA.avgCost || 10);
  const creditSubtotal = creditQty * creditUnitPrice;
  const creditCost = creditQty * creditUnitCost;
  await put("bills", {
    id: billCreditId, billNo: billCreditNo, date, customerId: customer.id, paymentType: "credit",
    subtotal: creditSubtotal, costTotal: creditCost, profitTotal: creditSubtotal - creditCost,
    paidAmount: 0, initialPaidAmount: 0, creditAmount: creditSubtotal, status: "credit",
    note: "TEST-AUTO ขายเครดิต", createdAt: now
  });
  await put("bill_items", {
    id: uid(), billId: billCreditId, productId: freshA.id, productNameSnapshot: freshA.name,
    qty: creditQty, unitPrice: creditUnitPrice, unitCost: creditUnitCost,
    revenue: creditSubtotal, cost: creditCost, profit: creditSubtotal - creditCost
  });
  await put("stock_movements", {
    id: uid(), productId: freshA.id, type: "sale", refType: "bill", refId: billCreditId, date,
    qtyIn: 0, qtyOut: creditQty, unitCost: creditUnitCost, note: `TEST-AUTO ขายบิล ${billCreditNo}`, createdAt: now
  });

  // รับเงินบางส่วน
  await put("payments", {
    id: uid(), customerId: customer.id, billId: billCreditId, date, amount: 25,
    method: "เงินสด", note: "TEST-AUTO รับเงินบางส่วน", createdAt: now
  });

  // ปรับสต็อก
  await put("stock_movements", {
    id: uid(), productId: freshB.id, type: "adjust_out", refType: "adjust", refId: "", date,
    qtyIn: 0, qtyOut: 1, unitCost: Number(freshB.avgCost || 20), note: "TEST-AUTO ปรับลดของเสีย", createdAt: now
  });

  // บิลยกเลิก
  const billCancelId = uid();
  const billCancelNo = "TEST-CANCEL-001";
  await put("bills", {
    id: billCancelId, billNo: billCancelNo, date, customerId: "", paymentType: "cash",
    subtotal: 25, costTotal: creditUnitCost, profitTotal: 25 - creditUnitCost,
    paidAmount: 25, initialPaidAmount: 25, creditAmount: 0, status: "cancelled",
    note: "TEST-AUTO บิลยกเลิก", cancelReason: "TEST-AUTO ทดสอบยกเลิกบิล", cancelledAt: now, createdAt: now
  });
  await put("bill_items", {
    id: uid(), billId: billCancelId, productId: freshA.id, productNameSnapshot: freshA.name,
    qty: 1, unitPrice: 25, unitCost: creditUnitCost,
    revenue: 25, cost: creditUnitCost, profit: 25 - creditUnitCost
  });
  // จำลองขายออกแล้วคืนเข้าเพื่อทดสอบการคืนสต็อก
  await put("stock_movements", {
    id: uid(), productId: freshA.id, type: "sale", refType: "bill", refId: billCancelId, date,
    qtyIn: 0, qtyOut: 1, unitCost: creditUnitCost, note: `TEST-AUTO ขายบิล ${billCancelNo}`, createdAt: now
  });
  await put("stock_movements", {
    id: uid(), productId: freshA.id, type: "sale_cancel", refType: "bill", refId: billCancelId, date,
    qtyIn: 1, qtyOut: 0, unitCost: creditUnitCost, note: `TEST-AUTO ยกเลิกบิล ${billCancelNo}`, createdAt: now
  });

  await recomputeInventory();
  await recalcBills();
  await loadState();
}

function runSystemChecks() {
  const results = [];

  // 1) ตรวจสินค้า stock ไม่ติดลบ
  const negativeProducts = state.products.filter(p => Number(p.stockQty || 0) < -0.0001);
  results.push({
    status: negativeProducts.length ? "fail" : "pass",
    title: "สินค้าไม่มีสต็อกติดลบ",
    detail: negativeProducts.length ? negativeProducts.map(p => `${p.name}: ${money(p.stockQty)}`).join(", ") : "ผ่าน"
  });

  // 2) ตรวจ stock ตาม movements
  const stockMismatches = state.products
    .filter(p => !p.isArchived)
    .map(p => ({ product: p, expected: calculateProductStockFromMovements(p.id), actual: Number(p.stockQty || 0) }))
    .filter(row => !assertNear(row.actual, row.expected));
  results.push({
    status: stockMismatches.length ? "fail" : "pass",
    title: "สต็อกตรงกับ Stock Movements",
    detail: stockMismatches.length ? stockMismatches.map(r => `${r.product.name}: ระบบ ${money(r.actual)} / คำนวณ ${money(r.expected)}`).join(", ") : "ผ่าน"
  });

  // 3) ตรวจยอดบิลกับ bill_items
  const billMismatches = state.bills.map(b => ({ bill: b, totals: calculateBillTotals(b.id) }))
    .filter(row => !assertNear(row.bill.subtotal, row.totals.subtotal) || !assertNear(row.bill.costTotal, row.totals.costTotal) || !assertNear(row.bill.profitTotal, row.totals.profitTotal));
  results.push({
    status: billMismatches.length ? "fail" : "pass",
    title: "ยอดบิล / ต้นทุน / กำไร ตรงกับรายการสินค้าในบิล",
    detail: billMismatches.length ? billMismatches.map(r => r.bill.billNo).join(", ") : "ผ่าน"
  });

  // 4) ตรวจ paid/credit status
  const paymentMismatches = activeBills().map(b => {
    const linked = state.payments.filter(p => p.billId === b.id).reduce((s, p) => s + Number(p.amount || 0), 0);
    const expectedPaid = Number(b.initialPaidAmount || 0) + linked;
    const expectedCredit = b.paymentType === "credit" ? Math.max(0, Number(b.subtotal || 0) - expectedPaid) : 0;
    return { bill: b, expectedPaid, expectedCredit };
  }).filter(r => !assertNear(r.bill.paidAmount, r.expectedPaid) || !assertNear(r.bill.creditAmount, r.expectedCredit));
  results.push({
    status: paymentMismatches.length ? "fail" : "pass",
    title: "ยอดรับเงินและยอดค้างของบิลถูกต้อง",
    detail: paymentMismatches.length ? paymentMismatches.map(r => r.bill.billNo).join(", ") : "ผ่าน"
  });

  // 5) ตรวจ payment ต้องผูกกับบิล สำหรับ payment ใหม่
  const unlinkedPayments = state.payments.filter(p => !p.billId && !(p.note || "").includes("legacy"));
  results.push({
    status: unlinkedPayments.length ? "fail" : "pass",
    title: "รายการรับเงินผูกกับบิล",
    detail: unlinkedPayments.length ? `พบ ${unlinkedPayments.length} รายการที่ไม่ผูกบิล` : "ผ่าน"
  });

  // 6) ตรวจบิลยกเลิกมีเหตุผล
  const cancelledNoReason = state.bills.filter(b => b.status === "cancelled" && !(b.cancelReason || "").trim());
  results.push({
    status: cancelledNoReason.length ? "fail" : "pass",
    title: "บิลยกเลิกมีเหตุผลการยกเลิก",
    detail: cancelledNoReason.length ? cancelledNoReason.map(b => b.billNo).join(", ") : "ผ่าน"
  });

  // 7) ตรวจข้อมูล TEST มีครบ (info)
  const testProducts = state.products.filter(isTestProduct).length;
  const testBills = state.bills.filter(isTestBill).length;
  const testPayments = state.payments.filter(isTestPayment).length;
  results.push({
    status: "info",
    title: "ข้อมูล TEST ที่พบ",
    detail: `สินค้า TEST ${testProducts} รายการ • บิล TEST ${testBills} บิล • รับเงิน TEST ${testPayments} รายการ`
  });

  return results;
}

async function clearTestData(showConfirm = true) {
  if (showConfirm && !confirm("ล้างข้อมูล TEST ทั้งหมดใช่ไหม?\n\nระบบจะลบเฉพาะข้อมูลที่ขึ้นต้น/มีหมายเหตุ TEST-AUTO เท่านั้น")) return;

  const testProductIds = state.products.filter(isTestProduct).map(p => p.id);
  const testCustomerIds = state.customers.filter(isTestCustomer).map(c => c.id);
  const testBillIds = state.bills.filter(isTestBill).map(b => b.id);

  for (const item of state.bill_items) {
    if (testBillIds.includes(item.billId) || testProductIds.includes(item.productId)) await del("bill_items", item.id);
  }
  for (const m of state.stock_movements) {
    if (isTestMovement(m) || testProductIds.includes(m.productId) || testBillIds.includes(m.refId)) await del("stock_movements", m.id);
  }
  for (const p of state.payments) {
    if (isTestPayment(p) || testCustomerIds.includes(p.customerId) || testBillIds.includes(p.billId)) await del("payments", p.id);
  }
  for (const b of state.bills) {
    if (isTestBill(b) || testBillIds.includes(b.id)) await del("bills", b.id);
  }
  for (const p of state.products) {
    if (testProductIds.includes(p.id)) await del("products", p.id);
  }
  for (const c of state.customers) {
    if (testCustomerIds.includes(c.id)) await del("customers", c.id);
  }

  await recomputeInventory();
  await recalcBills();
  await loadState();

  if (showConfirm) {
    showToast("ล้างข้อมูล TEST แล้ว");
    showTestResults([{ status: "info", title: "ล้างข้อมูล TEST แล้ว", detail: "ข้อมูลจริงที่ไม่ใช่ TEST ไม่ถูกลบ" }]);
  }
}

$("runAutoTestBtn")?.addEventListener("click", async () => {
  if (!confirm("เริ่ม Auto Test?\n\nระบบจะล้างข้อมูล TEST เดิม แล้วสร้างข้อมูล TEST ชุดใหม่")) return;
  await createAutoTestData();
  const results = runSystemChecks();
  showTestResults(results);
  showToast("ทดสอบระบบเสร็จแล้ว");
});

$("runCheckOnlyBtn")?.addEventListener("click", () => {
  const results = runSystemChecks();
  showTestResults(results);
});

$("clearTestDataBtn")?.addEventListener("click", async () => {
  await clearTestData(true);
});


$("copyDailyCloseBtn")?.addEventListener("click", copyDailyClose);
$("printDailyCloseBtn")?.addEventListener("click", printDailyClose);


$("copyLowStockBtn")?.addEventListener("click", copyLowStockList);
$("printLowStockBtn")?.addEventListener("click", printLowStockList);

$("repairCostsBtn")?.addEventListener("click", repairAllCosts);
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
