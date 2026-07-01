const DB_NAME = "mini-stock-credit-db";
const DB_VERSION = 1;
const STORES = ["products", "customers", "purchases", "sales", "payments"];

let db;
let state = { products: [], customers: [], purchases: [], sales: [], payments: [] };
let deferredPrompt = null;
const DEMO_LIMITS = { products: 30, customers: 20, sales: 100 };
const PRO_KEYS = ["PRO2026", "MINI-PRO", "STOCK-PRO"];
let currentNumberInput = null;
let numberPadValue = "";
let selectedLedgerCustomerId = "";
let saleCart = [];

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


function getPlan() {
  return localStorage.getItem("miniStockPlan") || "demo";
}
function isPro() {
  return getPlan() === "pro";
}
function setPlan(plan) {
  localStorage.setItem("miniStockPlan", plan);
  renderPlanUI();
}
function demoLimitReached(type) {
  return false;
}
function showUpgradeMessage(featureName) {
  alert(`${featureName} จะเปิดให้ใช้งานในเวอร์ชัน Pro ภายหลัง`);
}
function renderPlanUI() {
  const exportBtn = $("exportCsvBtn");
  if (exportBtn) {
    exportBtn.classList.remove("locked");
    exportBtn.textContent = "Export CSV";
  }
}


function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function tx(storeName, mode = "readonly") { return db.transaction(storeName, mode).objectStore(storeName); }
function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
function put(storeName, item) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}
function remove(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}
function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = tx(storeName, "readwrite").clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function refreshState() {
  const results = await Promise.all(STORES.map(getAll));
  STORES.forEach((name, index) => state[name] = results[index]);
  state.products.sort((a,b) => (a.name || "").localeCompare(b.name || "", "th"));
  state.customers.sort((a,b) => (a.name || "").localeCompare(b.name || "", "th"));
  state.purchases.sort((a,b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.sales.sort((a,b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.payments.sort((a,b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  renderAll();
}

function productName(id) { return state.products.find(p => p.id === id)?.name || "-"; }
function customerName(id) {
  if (!id) return "ลูกค้าเงินสด";
  return state.customers.find(c => c.id === id)?.name || "-";
}
function customerBalance(customerId) {
  const creditSales = state.sales
    .filter(s => s.customerId === customerId && s.paymentType === "credit")
    .reduce((sum, s) => sum + Number(s.revenue || 0) - Number(s.paidAmount || 0), 0);
  const payments = state.payments
    .filter(p => p.customerId === customerId)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return Math.max(0, creditSales - payments);
}

function setOptions(selectId, items, placeholder, labelFn) {
  const el = $(selectId);
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + items.map(item => `<option value="${item.id}">${labelFn(item)}</option>`).join("");
  if ([...el.options].some(o => o.value === current)) el.value = current;
}

async function rebuildInventoryFromTransactions() {
  const products = await getAll("products");
  const purchases = await getAll("purchases");
  const sales = await getAll("sales");

  const productMap = new Map();
  products.forEach(p => productMap.set(p.id, { ...p, stockQty: 0, avgCost: 0 }));

  const events = [
    ...purchases.map(p => ({ ...p, eventType: "purchase", sortKey: `${p.date || ""} ${p.createdAt || ""}` })),
    ...sales.map(s => ({ ...s, eventType: "sale", sortKey: `${s.date || ""} ${s.createdAt || ""}` }))
  ].sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  const updatedSales = [];

  for (const event of events) {
    const product = productMap.get(event.productId);
    if (!product) continue;

    if (event.eventType === "purchase") {
      const qty = Number(event.qty || 0);
      const totalCost = Number(event.totalCost || 0);
      const oldQty = Number(product.stockQty || 0);
      const oldValue = oldQty * Number(product.avgCost || 0);
      const newQty = oldQty + qty;
      product.avgCost = newQty > 0 ? (oldValue + totalCost) / newQty : 0;
      product.stockQty = newQty;
    }

    if (event.eventType === "sale") {
      const qty = Number(event.qty || 0);
      const revenue = Number(event.revenue || 0);
      const cost = qty * Number(product.avgCost || 0);
      const profit = revenue - cost;
      product.stockQty = Number(product.stockQty || 0) - qty;
      const { eventType, sortKey, ...cleanSale } = event;
      updatedSales.push({ ...cleanSale, cost, profit, recalculatedAt: new Date().toISOString() });
    }
  }

  for (const product of productMap.values()) await put("products", { ...product, updatedAt: new Date().toISOString() });
  for (const sale of updatedSales) await put("sales", sale);
}

function renderAll() {
  renderSelects();
  renderDashboard();
  renderProducts();
  renderCustomers();
  renderHistories();
  renderReports();
  renderLedger();
  renderReportFilters();
  renderProductQuickGrid();
  renderSaleCart();
  renderPlanUI();
  updateSalePreview();
}
function renderSelects() {
  setOptions("purchaseProduct", state.products, "เลือกสินค้า", p => `${p.name} (${money(p.stockQty)} ${p.unit || ""})`);
  setOptions("saleProduct", state.products, "เลือกสินค้า", p => `${p.name} | เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("saleCustomer", state.customers, "ลูกค้าเงินสด / ไม่ระบุ", c => `${c.name} (${c.type || "ทั่วไป"})`);
  setOptions("paymentCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} | ค้าง ${money(customerBalance(c.id))}`);
  if ($("reportCustomer")) setOptions("reportCustomer", state.customers, "ลูกค้าทั้งหมด", c => c.name);
  if ($("reportProduct")) setOptions("reportProduct", state.products, "สินค้าทั้งหมด", p => p.name);
}

function renderDashboard() {
  const totalSales = state.sales.reduce((s, x) => s + Number(x.revenue || 0), 0);
  const totalProfit = state.sales.reduce((s, x) => s + Number(x.profit || 0), 0);
  const totalCredit = state.customers.reduce((s, c) => s + customerBalance(c.id), 0);
  const stockValue = state.products.reduce((s, p) => s + Number(p.stockQty || 0) * Number(p.avgCost || 0), 0);
  $("kpiSales").textContent = money(totalSales);
  $("kpiProfit").textContent = money(totalProfit);
  $("kpiCredit").textContent = money(totalCredit);
  $("kpiStockValue").textContent = money(stockValue);

  const low = state.products.filter(p => Number(p.minStock || 0) > 0 && Number(p.stockQty || 0) <= Number(p.minStock || 0));
  $("lowStockList").innerHTML = low.length ? low.map(p => `
    <div class="list-item"><div><strong>${p.name}</strong><small>เหลือ ${money(p.stockQty)} ${p.unit || ""} • ขั้นต่ำ ${money(p.minStock)}</small></div><div class="money negative">ต่ำ</div></div>
  `).join("") : `<div class="list-item"><div><strong>ยังไม่มีสินค้าสต็อกต่ำ</strong><small>เมื่อสินค้าต่ำกว่าจุดแจ้งเตือน จะแสดงที่นี่</small></div></div>`;

  const debtors = state.customers.map(c => ({...c, balance: customerBalance(c.id)})).filter(c => c.balance > 0);
  $("creditList").innerHTML = debtors.length ? debtors.map(c => `
    <div class="list-item"><div><strong>${c.name}</strong><small>${c.type || "ทั่วไป"} ${c.phone ? "• " + c.phone : ""}</small></div><div class="money negative">${money(c.balance)}</div></div>
  `).join("") : `<div class="list-item"><div><strong>ยังไม่มีลูกหนี้ค้างชำระ</strong><small>ยอดเครดิตจะมาแสดงเมื่อมีการขายเครดิต</small></div></div>`;

  $("dashboardRecentSales").innerHTML = state.sales.slice(0, 5).map(s => `
    <div class="list-item"><div><strong>${productName(s.productId)} ${paymentBadge(s.paymentType)}</strong><small>${s.date} • ${customerName(s.customerId)} • จำนวน ${money(s.qty)}</small></div><div><div class="money">${money(s.revenue)}</div><small class="${s.profit >= 0 ? "positive":"negative"}">กำไร ${money(s.profit)}</small></div></div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีรายการขาย</strong><small>เริ่มขายสินค้าได้จากเมนูขาย POS</small></div></div>`;
}

function renderProducts() {
  $("productsTable").innerHTML = state.products.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small>${p.unit || ""} ${p.note ? "• " + p.note : ""}</small></td>
      <td>${money(p.stockQty)} ${p.unit || ""}</td>
      <td>${money(p.avgCost)}</td>
      <td>${money(p.retailPrice)}</td>
      <td>${money(p.wholesalePrice)}</td>
      <td><div class="row-actions">
        <button class="small-btn small-edit" onclick="editProduct('${p.id}')">แก้ไข</button>
        <button class="small-btn small-danger" onclick="deleteProduct('${p.id}')">ลบ</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td colspan="6">ยังไม่มีสินค้า</td></tr>`;
}

function renderCustomers() {
  $("customersTable").innerHTML = state.customers.map(c => {
    const bal = customerBalance(c.id);
    return `<tr>
      <td><strong>${c.name}</strong><br><small>${c.phone || ""} ${c.note ? "• " + c.note : ""}</small></td>
      <td>${c.type || "-"}</td>
      <td class="${bal > 0 ? "negative" : ""}">${money(bal)}</td>
      <td>${money(c.creditLimit)} / ${Number(c.creditDays || 0)} วัน</td>
      <td><div class="row-actions">
        <button class="small-btn" onclick="openCustomerLedger('${c.id}')">สมุดบัญชี</button>
        <button class="small-btn small-edit" onclick="editCustomer('${c.id}')">แก้ไข</button>
        <button class="small-btn small-danger" onclick="deleteCustomer('${c.id}')">ลบ</button>
      </div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5">ยังไม่มีลูกค้า</td></tr>`;
}

function paymentBadge(type) {
  return type === "credit" ? `<span class="badge badge-credit">เครดิต</span>` : `<span class="badge badge-cash">เงินสด</span>`;
}

function renderHistories() {
  $("purchaseHistory").innerHTML = state.purchases.slice(0, 30).map(p => `
    <div class="list-item">
      <div><strong>${productName(p.productId)}</strong><small>${p.date} • จำนวน ${money(p.qty)} • ทุน ${money(p.unitCost)} ${p.extraCost ? "• ค่าส่ง " + money(p.extraCost) : ""}</small>${p.note ? `<small>หมายเหตุ: ${p.note}</small>` : ""}</div>
      <div class="row-actions"><div class="money">${money(p.totalCost)}</div><button class="small-btn small-edit" onclick="editPurchase('${p.id}')">แก้ไข</button><button class="small-btn small-danger" onclick="deletePurchase('${p.id}')">ลบ</button></div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติซื้อเข้า</strong></div></div>`;

  $("saleHistory").innerHTML = state.sales.slice(0, 30).map(s => `
    <div class="list-item">
      <div><strong>${productName(s.productId)}</strong> ${paymentBadge(s.paymentType)}<small>${s.date} • ${customerName(s.customerId)} • จำนวน ${money(s.qty)} • ราคา ${money(s.unitPrice)}</small>${s.note ? `<small>หมายเหตุ: ${s.note}</small>` : ""}</div>
      <div class="row-actions"><div><div class="money">${money(s.revenue)}</div><small class="${Number(s.profit) >= 0 ? "positive" : "negative"}">กำไร ${money(s.profit)}</small></div><button class="small-btn small-edit" onclick="editSale('${s.id}')">แก้ไข</button><button class="small-btn small-danger" onclick="deleteSale('${s.id}')">ลบ</button></div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติขาย</strong><small>เลือกสินค้าแล้วบันทึกขายได้เลย</small></div></div>`;

  $("paymentHistory").innerHTML = state.payments.slice(0, 30).map(p => `
    <div class="list-item">
      <div><strong>${customerName(p.customerId)}</strong><small>${p.date} • ${p.method || ""} ${p.note ? "• " + p.note : ""}</small></div>
      <div class="row-actions"><div class="money positive">${money(p.amount)}</div><button class="small-btn small-edit" onclick="editPayment('${p.id}')">แก้ไข</button><button class="small-btn small-danger" onclick="deletePayment('${p.id}')">ลบ</button></div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติรับชำระ</strong></div></div>`;
}


function getCustomerLedgerEntries(customerId) {
  const salesEntries = state.sales
    .filter(s => s.customerId === customerId && s.paymentType === "credit")
    .map(s => ({
      type: "sale",
      date: s.date,
      createdAt: s.createdAt || "",
      title: `ขายเครดิต: ${productName(s.productId)}`,
      detail: `จำนวน ${money(s.qty)} • ราคา ${money(s.unitPrice)} • กำไร ${money(s.profit)}`,
      amount: Number(s.revenue || 0),
      id: s.id
    }));

  const paymentEntries = state.payments
    .filter(p => p.customerId === customerId)
    .map(p => ({
      type: "payment",
      date: p.date,
      createdAt: p.createdAt || "",
      title: `รับชำระ (${p.method || "-"})`,
      detail: p.note || "รับชำระลูกหนี้",
      amount: -Number(p.amount || 0),
      id: p.id
    }));

  return [...salesEntries, ...paymentEntries]
    .sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function renderLedger() {
  if (!$("ledgerCustomerList")) return;
  const q = ($("ledgerCustomerSearch")?.value || "").trim().toLowerCase();
  const list = state.customers
    .map(c => ({ ...c, balance: customerBalance(c.id) }))
    .filter(c => !q || `${c.name} ${c.phone || ""} ${c.type || ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

  $("ledgerCustomerList").innerHTML = list.map(c => `
    <div class="list-item ledger-customer-card ${selectedLedgerCustomerId === c.id ? "active" : ""}" onclick="openCustomerLedger('${c.id}')">
      <div>
        <strong>${c.name}</strong>
        <small>${c.type || "ทั่วไป"} ${c.phone ? "• " + c.phone : ""}</small>
      </div>
      <div class="${c.balance > 0 ? "negative" : "positive"} money">${money(c.balance)}</div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีลูกค้า</strong><small>เพิ่มลูกค้าได้จากเมนูลูกค้า</small></div></div>`;

  const customer = state.customers.find(c => c.id === selectedLedgerCustomerId);
  if (!customer) {
    $("ledgerCustomerName").textContent = "เลือกชื่อลูกค้า";
    $("ledgerCustomerMeta").textContent = "ดูประวัติลูกหนี้รายคน";
    $("ledgerBalance").textContent = money(0);
    $("ledgerCreditSales").textContent = money(0);
    $("ledgerPayments").textContent = money(0);
    $("ledgerLimit").textContent = money(0);
    $("ledgerEntries").innerHTML = `<div class="list-item"><div><strong>กรุณาเลือกลูกค้า</strong><small>เลือกลูกค้าด้านซ้ายเพื่อดูสมุดบัญชี</small></div></div>`;
    return;
  }

  const entries = getCustomerLedgerEntries(customer.id);
  const creditSales = state.sales
    .filter(s => s.customerId === customer.id && s.paymentType === "credit")
    .reduce((sum, s) => sum + Number(s.revenue || 0), 0);
  const paid = state.payments
    .filter(p => p.customerId === customer.id)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  $("ledgerCustomerName").textContent = customer.name;
  $("ledgerCustomerMeta").textContent = `${customer.type || "ทั่วไป"} ${customer.phone ? "• " + customer.phone : ""}`;
  $("ledgerBalance").textContent = money(customerBalance(customer.id));
  $("ledgerCreditSales").textContent = money(creditSales);
  $("ledgerPayments").textContent = money(paid);
  $("ledgerLimit").textContent = money(customer.creditLimit || 0);

  let running = 0;
  const chronological = [...entries].reverse();
  const balances = new Map();
  chronological.forEach(e => {
    running += Number(e.amount || 0);
    balances.set(`${e.type}-${e.id}`, running);
  });

  $("ledgerEntries").innerHTML = entries.map(e => {
    const amountClass = e.type === "sale" ? "entry-amount-plus" : "entry-amount-minus";
    const amountText = `${e.type === "sale" ? "+" : "-"}${money(Math.abs(e.amount))}`;
    const entryClass = e.type === "sale" ? "sale-entry" : "payment-entry";
    const bal = balances.get(`${e.type}-${e.id}`) || 0;
    return `
      <div class="list-item ledger-entry ${entryClass}">
        <div>
          <strong>${e.title}</strong>
          <small>${e.date} • ${e.detail}</small>
          <small>ยอดคงเหลือหลังรายการนี้: ${money(Math.max(0, bal))}</small>
        </div>
        <div class="${amountClass}">${amountText}</div>
      </div>
    `;
  }).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติเครดิต</strong><small>รายการขายเครดิตและรับชำระจะแสดงที่นี่</small></div></div>`;
}

window.openCustomerLedger = (customerId) => {
  selectedLedgerCustomerId = customerId;
  renderLedger();
  switchTab("ledger");
};

function getFilteredSales() {
  const from = $("reportDateFrom")?.value || "";
  const to = $("reportDateTo")?.value || "";
  const customerId = $("reportCustomer")?.value || "";
  const productId = $("reportProduct")?.value || "";
  const paymentType = $("reportPaymentType")?.value || "";

  return state.sales.filter(s => {
    if (from && String(s.date || "") < from) return false;
    if (to && String(s.date || "") > to) return false;
    if (customerId && s.customerId !== customerId) return false;
    if (productId && s.productId !== productId) return false;
    if (paymentType && s.paymentType !== paymentType) return false;
    return true;
  });
}

function renderReports() {
  if (!$("reportSalesTable")) return;
  const filtered = getFilteredSales();
  const sumSales = filtered.reduce((sum, s) => sum + Number(s.revenue || 0), 0);
  const sumCost = filtered.reduce((sum, s) => sum + Number(s.cost || 0), 0);
  const sumProfit = filtered.reduce((sum, s) => sum + Number(s.profit || 0), 0);

  if ($("reportSumSales")) $("reportSumSales").textContent = money(sumSales);
  if ($("reportSumCost")) $("reportSumCost").textContent = money(sumCost);
  if ($("reportSumProfit")) $("reportSumProfit").textContent = money(sumProfit);
  if ($("reportSumCount")) $("reportSumCount").textContent = filtered.length.toLocaleString("th-TH");

  $("reportSalesTable").innerHTML = filtered.map(s => {
    const paid = s.paymentType === "cash" ? "ชำระแล้ว" : (Number(s.paidAmount || 0) >= Number(s.revenue || 0) ? "ชำระแล้ว" : "เครดิต");
    return `<tr>
      <td>${s.date}</td><td>${customerName(s.customerId)}</td><td>${productName(s.productId)}</td><td>${money(s.qty)}</td>
      <td>${money(s.revenue)}</td><td>${money(s.cost)}</td><td class="${Number(s.profit) >= 0 ? "positive" : "negative"}">${money(s.profit)}</td><td>${paid}</td>
      <td><div class="row-actions"><button class="small-btn small-edit" onclick="editSale('${s.id}')">แก้ไข</button><button class="small-btn small-danger" onclick="deleteSale('${s.id}')">ลบ</button></div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9">ไม่พบรายการขายตามตัวกรอง</td></tr>`;
}

function renderReportFilters() {
  if (!$("reportCustomer")) return;
  // select options are handled by renderSelects; this function keeps report summary live
}

function renderProductQuickGrid() {
  const q = ($("saleProductSearch")?.value || "").trim().toLowerCase();
  const list = state.products.filter(p => !q || `${p.name} ${p.note || ""}`.toLowerCase().includes(q)).slice(0, 24);
  $("productQuickGrid").innerHTML = list.map(p => `
    <button class="product-tile" type="button" onclick="quickSelectProduct('${p.id}')">
      <strong>${p.name}</strong>
      <small>คงเหลือ ${money(p.stockQty)} ${p.unit || ""} • ทุน ${money(p.avgCost)}</small>
      <div class="tile-price"><span>ปลีก ${money(p.retailPrice)}</span><span>ส่ง ${money(p.wholesalePrice)}</span></div><span class="tile-hint">แตะเพื่อเลือก</span>
    </button>
  `).join("") || `<div class="list-item"><div><strong>ไม่พบสินค้า</strong><small>เพิ่มสินค้าได้ที่เมนูสินค้า</small></div></div>`;
}

window.quickSelectProduct = (id) => {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  $("saleProduct").value = id;
  $("saleQty").value = $("saleQty").value || 1;
  $("saleUnitPrice").value = p.retailPrice || p.wholesalePrice || 0;
  updateSalePreview();
  showToast(`เลือกสินค้า ${p.name}`);
};


function currentCartQty(productId) {
  return saleCart.filter(x => x.productId === productId).reduce((sum, x) => sum + Number(x.qty || 0), 0);
}
function getSaleLineFromForm() {
  const product = state.products.find(p => p.id === $("saleProduct").value);
  if (!product) { alert("กรุณาเลือกสินค้า"); return null; }
  const qty = Number($("saleQty").value || 0);
  const unitPrice = Number($("saleUnitPrice").value || 0);
  if (qty <= 0) { alert("กรุณาระบุจำนวนขาย"); return null; }
  if (unitPrice < 0) { alert("ราคาขายไม่ถูกต้อง"); return null; }
  const inCart = currentCartQty(product.id);
  const editingSaleId = $("saleId").value;
  const editingSale = state.sales.find(s => s.id === editingSaleId);
  const oldQtySameProduct = editingSale && editingSale.productId === product.id ? Number(editingSale.qty || 0) : 0;
  const available = Number(product.stockQty || 0) + oldQtySameProduct;
  if (!editingSaleId && inCart + qty > available) {
    alert(`สต็อกไม่พอ เหลือที่เพิ่มเข้าบิลได้ ${money(Math.max(0, available - inCart))} ${product.unit || ""}`);
    return null;
  }
  const revenue = qty * unitPrice;
  const cost = qty * Number(product.avgCost || 0);
  return {
    lineId: uid(), productId: product.id, productName: product.name, unit: product.unit || "",
    qty, unitPrice, avgCost: Number(product.avgCost || 0), revenue, cost, profit: revenue - cost,
    note: $("saleNote").value.trim()
  };
}
function addCurrentLineToCart() {
  if ($("saleId").value) return alert("กำลังแก้ไขรายการขายเดิมอยู่ ไม่สามารถเพิ่มเข้าบิลได้ กรุณายกเลิกแก้ไขก่อน");
  const line = getSaleLineFromForm();
  if (!line) return;
  const existing = saleCart.find(x => x.productId === line.productId && Number(x.unitPrice) === Number(line.unitPrice));
  if (existing) {
    const product = state.products.find(p => p.id === line.productId);
    const newQty = Number(existing.qty || 0) + line.qty;
    if (newQty > Number(product?.stockQty || 0)) return alert("จำนวนรวมในบิลมากกว่าสต็อกคงเหลือ");
    existing.qty = newQty;
    existing.revenue = existing.qty * existing.unitPrice;
    existing.cost = existing.qty * existing.avgCost;
    existing.profit = existing.revenue - existing.cost;
  } else {
    saleCart.push(line);
  }
  $("saleQty").value = 1;
  renderSaleCart();
  updateSalePreview();
  showToast("เพิ่มสินค้าเข้าบิลแล้ว");
}
function renderSaleCart() {
  if (!$("saleCartList")) return;
  $("saleCartList").innerHTML = saleCart.length ? saleCart.map(line => `
    <div class="cart-item">
      <div>
        <strong>${line.productName}</strong>
        <small>${money(line.qty)} ${line.unit} × ${money(line.unitPrice)} = ${money(line.revenue)}</small>
        <small class="${line.profit >= 0 ? "positive" : "negative"}">กำไรประมาณ ${money(line.profit)}</small>
      </div>
      <div class="cart-controls">
        <button class="qty-btn" type="button" onclick="changeCartQty('${line.lineId}', -1)">−</button>
        <span class="qty-pill">${money(line.qty)}</span>
        <button class="qty-btn" type="button" onclick="changeCartQty('${line.lineId}', 1)">+</button>
        <button class="cart-remove" type="button" onclick="removeCartLine('${line.lineId}')">ลบ</button>
      </div>
    </div>
  `).join("") : `<div class="list-item"><div><strong>ยังไม่มีสินค้าในบิล</strong><small>เลือกสินค้า แล้วกด + เพิ่มเข้าบิล</small></div></div>`;
  const revenue = saleCart.reduce((s, x) => s + Number(x.revenue || 0), 0);
  const profit = saleCart.reduce((s, x) => s + Number(x.profit || 0), 0);
  $("cartCount").textContent = saleCart.length.toLocaleString("th-TH");
  $("cartRevenue").textContent = money(revenue);
  $("cartProfit").textContent = money(profit);
}
window.changeCartQty = (lineId, delta) => {
  const line = saleCart.find(x => x.lineId === lineId);
  if (!line) return;
  const product = state.products.find(p => p.id === line.productId);
  const newQty = Number(line.qty || 0) + delta;
  if (newQty <= 0) return removeCartLine(lineId);
  const otherQty = saleCart.filter(x => x.productId === line.productId && x.lineId !== lineId).reduce((s,x)=>s+Number(x.qty||0),0);
  if (newQty + otherQty > Number(product?.stockQty || 0)) return alert("จำนวนในบิลมากกว่าสต็อกคงเหลือ");
  line.qty = newQty;
  line.revenue = line.qty * line.unitPrice;
  line.cost = line.qty * line.avgCost;
  line.profit = line.revenue - line.cost;
  renderSaleCart();
};
window.removeCartLine = (lineId) => {
  saleCart = saleCart.filter(x => x.lineId !== lineId);
  renderSaleCart();
};
function clearSaleCart() {
  saleCart = [];
  renderSaleCart();
}
async function saveSaleCart() {
  if (!saleCart.length) return alert("ยังไม่มีสินค้าในบิล");
  const paymentType = $("salePaymentType").value;
  const customerId = $("saleCustomer").value;
  if (paymentType === "credit" && !customerId) return alert("ขายเครดิตต้องเลือกลูกค้า");
  const totalRevenue = saleCart.reduce((s,x)=>s+Number(x.revenue||0),0);
  let remainingPaid = paymentType === "cash" ? totalRevenue : Number($("salePaidAmount").value || 0);
  if (remainingPaid > totalRevenue) return alert("รับเงินแล้วห้ามมากกว่ายอดขายรวม");
  const invoiceNo = `INV-${Date.now()}`;
  for (const line of saleCart) {
    const paidAmount = paymentType === "cash" ? line.revenue : Math.min(remainingPaid, line.revenue);
    remainingPaid = Math.max(0, remainingPaid - paidAmount);
    await put("sales", {
      id: uid(), invoiceNo, date: $("saleDate").value, customerId: customerId || "", productId: line.productId,
      qty: line.qty, unitPrice: line.unitPrice, revenue: line.revenue, cost: 0, profit: 0,
      paymentType, paidAmount, note: $("saleNote").value.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
  }
  await rebuildInventoryFromTransactions();
  clearSaleCart();
  resetSaleForm();
  showToast("บันทึกทั้งบิลแล้ว");
  await refreshState();
}

$("saleProductSearch").addEventListener("input", renderProductQuickGrid);

function switchTab(tabId) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === tabId));
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.openTab)));

function setDefaultDates() { ["purchaseDate","saleDate","paymentDate"].forEach(id => $(id).value = today()); }
setDefaultDates();

function resetProductForm(){ $("productForm").reset(); $("productId").value=""; $("productRetailPrice").value=0; $("productWholesalePrice").value=0; $("productMinStock").value=0; $("productSubmitBtn").textContent="บันทึกสินค้า"; }
function resetCustomerForm(){ $("customerForm").reset(); $("customerId").value=""; $("customerCreditLimit").value=0; $("customerCreditDays").value=0; $("customerSubmitBtn").textContent="บันทึกลูกค้า"; }
function resetPurchaseForm(){ $("purchaseForm").reset(); $("purchaseId").value=""; $("purchaseDate").value=today(); $("purchaseExtraCost").value=0; $("purchaseSubmitBtn").textContent="บันทึกซื้อเข้า"; $("purchaseEditBanner").classList.add("hidden"); $("cancelPurchaseEdit").classList.add("hidden"); }
function resetSaleForm(){ $("saleForm").reset(); $("saleId").value=""; $("saleDate").value=today(); $("salePaidAmount").value=0; $("saleSubmitBtn").textContent="บันทึกขาย"; $("saleEditBanner").classList.add("hidden"); $("cancelSaleEdit").classList.add("hidden"); updateSalePreview(); }
function resetPaymentForm(){ $("paymentForm").reset(); $("paymentId").value=""; $("paymentDate").value=today(); $("paymentSubmitBtn").textContent="บันทึกรับชำระ"; $("paymentEditBanner").classList.add("hidden"); $("cancelPaymentEdit").classList.add("hidden"); }

$("resetProductForm").addEventListener("click", resetProductForm);
$("resetCustomerForm").addEventListener("click", resetCustomerForm);
$("cancelPurchaseEdit").addEventListener("click", resetPurchaseForm);
$("cancelSaleEdit").addEventListener("click", resetSaleForm);
$("clearSaleForm").addEventListener("click", resetSaleForm);
$("addToCartBtn").addEventListener("click", addCurrentLineToCart);
$("saveCartBtn").addEventListener("click", saveSaleCart);
$("clearCartBtn").addEventListener("click", clearSaleCart);
$("cancelPaymentEdit").addEventListener("click", resetPaymentForm);

$("productForm").addEventListener("submit", async (e)=>{e.preventDefault(); const id=$("productId").value||uid(); const existing=state.products.find(p=>p.id===id)||{}; await put("products",{...existing,id,name:$("productName").value.trim(),unit:$("productUnit").value.trim(),retailPrice:Number($("productRetailPrice").value||0),wholesalePrice:Number($("productWholesalePrice").value||0),minStock:Number($("productMinStock").value||0),note:$("productNote").value.trim(),stockQty:Number(existing.stockQty||0),avgCost:Number(existing.avgCost||0),updatedAt:new Date().toISOString()}); resetProductForm(); showToast("บันทึกสินค้าแล้ว"); await refreshState();});
window.editProduct=(id)=>{const p=state.products.find(x=>x.id===id); if(!p)return; $("productId").value=p.id; $("productName").value=p.name||""; $("productUnit").value=p.unit||""; $("productRetailPrice").value=p.retailPrice||0; $("productWholesalePrice").value=p.wholesalePrice||0; $("productMinStock").value=p.minStock||0; $("productNote").value=p.note||""; $("productSubmitBtn").textContent="อัปเดตสินค้า"; switchTab("products");};
window.deleteProduct=async(id)=>{const used=state.purchases.some(x=>x.productId===id)||state.sales.some(x=>x.productId===id); if(used)return alert("สินค้านี้มีประวัติซื้อ/ขายแล้ว ยังไม่ควรลบ ให้แก้ชื่อแทน"); if(confirm("ลบสินค้านี้ใช่ไหม?")){await remove("products",id); await refreshState();}};

$("customerForm").addEventListener("submit", async (e)=>{e.preventDefault(); const id=$("customerId").value||uid(); const existing=state.customers.find(c=>c.id===id)||{}; await put("customers",{...existing,id,name:$("customerName").value.trim(),type:$("customerType").value,phone:$("customerPhone").value.trim(),creditLimit:Number($("customerCreditLimit").value||0),creditDays:Number($("customerCreditDays").value||0),note:$("customerNote").value.trim(),updatedAt:new Date().toISOString()}); resetCustomerForm(); showToast("บันทึกลูกค้าแล้ว"); await refreshState();});
window.editCustomer=(id)=>{const c=state.customers.find(x=>x.id===id); if(!c)return; $("customerId").value=c.id; $("customerName").value=c.name||""; $("customerType").value=c.type||"ทั่วไป"; $("customerPhone").value=c.phone||""; $("customerCreditLimit").value=c.creditLimit||0; $("customerCreditDays").value=c.creditDays||0; $("customerNote").value=c.note||""; $("customerSubmitBtn").textContent="อัปเดตลูกค้า"; switchTab("customers");};
window.deleteCustomer=async(id)=>{const used=state.sales.some(x=>x.customerId===id)||state.payments.some(x=>x.customerId===id); if(used)return alert("ลูกค้านี้มีประวัติขาย/รับชำระแล้ว ยังไม่ควรลบ ให้แก้ชื่อแทน"); if(confirm("ลบลูกค้านี้ใช่ไหม?")){await remove("customers",id); await refreshState();}};

$("purchaseForm").addEventListener("submit", async(e)=>{e.preventDefault(); const productId=$("purchaseProduct").value; if(!state.products.find(p=>p.id===productId))return alert("กรุณาเลือกสินค้า"); const id=$("purchaseId").value||uid(); const existing=state.purchases.find(p=>p.id===id)||{}; const qty=Number($("purchaseQty").value||0); const unitCost=Number($("purchaseUnitCost").value||0); const extraCost=Number($("purchaseExtraCost").value||0); await put("purchases",{...existing,id,date:$("purchaseDate").value,productId,qty,unitCost,extraCost,totalCost:(qty*unitCost)+extraCost,note:$("purchaseNote").value.trim(),createdAt:existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()}); await rebuildInventoryFromTransactions(); resetPurchaseForm(); showToast(existing.id?"อัปเดตรายการซื้อเข้าแล้ว":"บันทึกซื้อเข้าแล้ว"); await refreshState();});
window.editPurchase=(id)=>{const p=state.purchases.find(x=>x.id===id); if(!p)return; $("purchaseId").value=p.id; $("purchaseDate").value=p.date||today(); $("purchaseProduct").value=p.productId||""; $("purchaseQty").value=p.qty||""; $("purchaseUnitCost").value=p.unitCost||""; $("purchaseExtraCost").value=p.extraCost||0; $("purchaseNote").value=p.note||""; $("purchaseSubmitBtn").textContent="อัปเดตซื้อเข้า"; $("purchaseEditBanner").classList.remove("hidden"); $("cancelPurchaseEdit").classList.remove("hidden"); switchTab("purchase");};
window.deletePurchase=async(id)=>{const item=state.purchases.find(x=>x.id===id); if(!item)return; if(confirm(`ลบรายการซื้อเข้า?\n\nสินค้า: ${productName(item.productId)}\nวันที่: ${item.date}\nจำนวน: ${money(item.qty)}\n\nระบบจะคำนวณสต็อกและต้นทุนใหม่`)){await remove("purchases",id); await rebuildInventoryFromTransactions(); await refreshState(); showToast("ลบรายการซื้อเข้าแล้ว");}};

function updateSalePreview(){const product=state.products.find(p=>p.id===$("saleProduct").value); const qty=Number($("saleQty").value||0); const price=Number($("saleUnitPrice").value||0); const revenue=qty*price; const cost=qty*Number(product?.avgCost||0); $("salePreviewRevenue").textContent=money(revenue); $("salePreviewCost").textContent=money(cost); $("salePreviewProfit").textContent=money(revenue-cost);}
["saleProduct","saleQty","saleUnitPrice"].forEach(id=>$(id).addEventListener("input",updateSalePreview));
$("saleProduct").addEventListener("change",()=>{const p=state.products.find(x=>x.id===$("saleProduct").value); if(p && !$("saleUnitPrice").value) $("saleUnitPrice").value=p.retailPrice||p.wholesalePrice||0; updateSalePreview();});
$("salePaymentType").addEventListener("change",()=>{if($("salePaymentType").value==="cash"){$("salePaidAmount").value=Number($("saleQty").value||0)*Number($("saleUnitPrice").value||0)}else{$("salePaidAmount").value=0}});

$("saleForm").addEventListener("submit", async(e)=>{e.preventDefault(); const product=state.products.find(p=>p.id===$("saleProduct").value); if(!product)return alert("กรุณาเลือกสินค้า"); const id=$("saleId").value||uid(); const existing=state.sales.find(s=>s.id===id)||{}; const qty=Number($("saleQty").value||0); const oldQtySameProduct=existing.productId===product.id?Number(existing.qty||0):0; const available=Number(product.stockQty||0)+oldQtySameProduct; if(qty>available)return alert(`สต็อกไม่พอ เหลือที่ขายได้ ${money(available)} ${product.unit||""}`); const paymentType=$("salePaymentType").value; const customerId=$("saleCustomer").value; if(paymentType==="credit"&&!customerId)return alert("ขายเครดิตต้องเลือกลูกค้า"); const unitPrice=Number($("saleUnitPrice").value||0); const revenue=qty*unitPrice; let paidAmount=Number($("salePaidAmount").value||0); if(paymentType==="cash")paidAmount=revenue; if(paidAmount>revenue)return alert("รับเงินแล้วห้ามมากกว่ายอดขาย"); await put("sales",{...existing,id,date:$("saleDate").value,customerId:customerId||"",productId:product.id,qty,unitPrice,revenue,cost:0,profit:0,paymentType,paidAmount,note:$("saleNote").value.trim(),createdAt:existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()}); await rebuildInventoryFromTransactions(); resetSaleForm(); showToast(existing.id?"อัปเดตรายการขายแล้ว":"บันทึกขายแล้ว"); await refreshState();});
window.editSale=(id)=>{const s=state.sales.find(x=>x.id===id); if(!s)return; $("saleId").value=s.id; $("saleDate").value=s.date||today(); $("saleCustomer").value=s.customerId||""; $("saleProduct").value=s.productId||""; $("saleQty").value=s.qty||""; $("saleUnitPrice").value=s.unitPrice||""; $("salePaymentType").value=s.paymentType||"cash"; $("salePaidAmount").value=s.paidAmount||0; $("saleNote").value=s.note||""; $("saleSubmitBtn").textContent="อัปเดตรายการขาย"; $("saleEditBanner").classList.remove("hidden"); $("cancelSaleEdit").classList.remove("hidden"); updateSalePreview(); switchTab("sale");};
window.deleteSale=async(id)=>{const item=state.sales.find(x=>x.id===id); if(!item)return; if(confirm(`ลบรายการขาย?\n\nสินค้า: ${productName(item.productId)}\nลูกค้า: ${customerName(item.customerId)}\nวันที่: ${item.date}\nยอดขาย: ${money(item.revenue)} บาท\n\nระบบจะคืนสต็อกและคำนวณกำไร/ลูกหนี้ใหม่`)){await remove("sales",id); await rebuildInventoryFromTransactions(); await refreshState(); showToast("ลบรายการขายแล้ว");}};

$("paymentForm").addEventListener("submit", async(e)=>{e.preventDefault(); const customerId=$("paymentCustomer").value; const amount=Number($("paymentAmount").value||0); if(!customerId)return alert("กรุณาเลือกลูกค้า"); if(amount<=0)return alert("กรุณาระบุจำนวนเงิน"); const id=$("paymentId").value||uid(); const existing=state.payments.find(p=>p.id===id)||{}; await put("payments",{...existing,id,date:$("paymentDate").value,customerId,amount,method:$("paymentMethod").value,note:$("paymentNote").value.trim(),createdAt:existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()}); resetPaymentForm(); showToast(existing.id?"อัปเดตรับชำระแล้ว":"บันทึกรับชำระแล้ว"); await refreshState();});
window.editPayment=(id)=>{const p=state.payments.find(x=>x.id===id); if(!p)return; $("paymentId").value=p.id; $("paymentDate").value=p.date||today(); $("paymentCustomer").value=p.customerId||""; $("paymentAmount").value=p.amount||""; $("paymentMethod").value=p.method||"เงินสด"; $("paymentNote").value=p.note||""; $("paymentSubmitBtn").textContent="อัปเดตรับชำระ"; $("paymentEditBanner").classList.remove("hidden"); $("cancelPaymentEdit").classList.remove("hidden"); switchTab("payments");};
window.deletePayment=async(id)=>{const item=state.payments.find(x=>x.id===id); if(!item)return; if(confirm(`ลบรายการรับชำระ?\n\nลูกค้า: ${customerName(item.customerId)}\nวันที่: ${item.date}\nจำนวนเงิน: ${money(item.amount)} บาท\n\nยอดลูกหนี้จะถูกคำนวณใหม่`)){await remove("payments",id); await refreshState(); showToast("ลบรายการรับชำระแล้ว");}};

function download(filename, content, type="application/octet-stream"){const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);}
$("exportBackupBtn").addEventListener("click",()=>{const data={app:"Khaikhong",version:"0.9",exportedAt:new Date().toISOString(),...state}; download(`mini-stock-credit-backup-${today()}.json`,JSON.stringify(data,null,2),"application/json");});
$("importBackupInput").addEventListener("change",async(e)=>{const file=e.target.files[0]; if(!file)return; const text=await file.text(); const data=JSON.parse(text); if(!confirm("นำเข้า Backup จะเขียนข้อมูลทับในเครื่องนี้ ต้องการทำต่อไหม?"))return; for(const store of STORES)await clearStore(store); for(const store of STORES){for(const item of(data[store]||[]))await put(store,item)} await rebuildInventoryFromTransactions(); showToast("นำเข้า Backup แล้ว"); await refreshState();});
$("exportCsvBtn").addEventListener("click",()=>{const rows=[["วันที่","ลูกค้า","สินค้า","จำนวน","ราคาต่อหน่วย","ยอดขาย","ต้นทุน","กำไร","ประเภทชำระ","รับแล้ว"]]; getFilteredSales().forEach(s=>rows.push([s.date,customerName(s.customerId),productName(s.productId),s.qty,s.unitPrice,s.revenue,s.cost,s.profit,s.paymentType==="credit"?"เครดิต":"เงินสด",s.paidAmount])); const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n"); download(`sales-report-${today()}.csv`,"\ufeff"+csv,"text/csv;charset=utf-8");});
$("clearAllBtn").addEventListener("click",async()=>{if(!confirm("ยืนยันล้างข้อมูลทั้งหมด? แนะนำให้ Export Backup ก่อน"))return; for(const store of STORES)await clearStore(store); resetProductForm(); resetCustomerForm(); resetPurchaseForm(); resetSaleForm(); resetPaymentForm(); await refreshState(); showToast("ล้างข้อมูลแล้ว");});


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
function setNumberPadValue(value) {
  numberPadValue = value;
  $("numpadDisplay").textContent = numberPadValue || "0";
}
document.addEventListener("focusin", (e) => {
  if (e.target?.matches?.('input[data-keypad="true"]')) {
    e.target.blur();
    openNumberPad(e.target);
  }
});
document.querySelectorAll("[data-num]").forEach(btn => {
  btn.addEventListener("click", () => {
    const n = btn.dataset.num;
    if (n === "." && numberPadValue.includes(".")) return;
    if (numberPadValue === "0" && n !== ".") setNumberPadValue(n);
    else setNumberPadValue(numberPadValue + n);
  });
});
$("numpadBack").addEventListener("click", () => setNumberPadValue(numberPadValue.slice(0, -1)));
$("numpadClear").addEventListener("click", () => setNumberPadValue(""));
$("numpadOk").addEventListener("click", () => {
  if (currentNumberInput) {
    currentNumberInput.value = numberPadValue || "0";
    currentNumberInput.dispatchEvent(new Event("input", { bubbles: true }));
    currentNumberInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeNumberPad();
});
$("numpadClose").addEventListener("click", closeNumberPad);
$("numberPadOverlay").addEventListener("click", (e) => {
  if (e.target.id === "numberPadOverlay") closeNumberPad();
});

$("unlockProBtn").addEventListener("click", () => {
  const key = ($("licenseKeyInput").value || "").trim().toUpperCase();
  if (PRO_KEYS.includes(key)) {
    setPlan("pro");
    showToast("ปลดล็อก Pro แล้ว");
  } else {
    alert("รหัสไม่ถูกต้อง\\nรหัสทดสอบ: PRO2026");
  }
});
$("resetDemoBtn").addEventListener("click", () => {
  if (confirm("กลับเป็น Demo ในเครื่องนี้ใช่ไหม?")) {
    setPlan("demo");
    showToast("กลับเป็น Demo แล้ว");
  }
});



["reportDateFrom","reportDateTo","reportCustomer","reportProduct","reportPaymentType"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("input", renderReports);
  if (el) el.addEventListener("change", renderReports);
});
if ($("resetReportFilter")) {
  $("resetReportFilter").addEventListener("click", () => {
    ["reportDateFrom","reportDateTo","reportCustomer","reportProduct","reportPaymentType"].forEach(id => {
      const el = $(id);
      if (el) el.value = "";
    });
    renderReports();
  });
}
if ($("ledgerCustomerSearch")) $("ledgerCustomerSearch").addEventListener("input", renderLedger);
if ($("ledgerClearSelection")) $("ledgerClearSelection").addEventListener("click", () => {
  selectedLedgerCustomerId = "";
  renderLedger();
});

window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault(); deferredPrompt=e; $("installBtn").classList.remove("hidden");});
$("installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("installBtn").classList.add("hidden");});

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));}

(async function init(){db=await openDB(); await rebuildInventoryFromTransactions(); await refreshState();})();
