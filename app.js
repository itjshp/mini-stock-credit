const DB_NAME = "mini-stock-credit-db";
const DB_VERSION = 1;
const STORES = ["products", "customers", "purchases", "sales", "payments"];

let db;
let state = { products: [], customers: [], purchases: [], sales: [], payments: [] };
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2200);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

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
  state.products.sort((a,b) => a.name.localeCompare(b.name, "th"));
  state.customers.sort((a,b) => a.name.localeCompare(b.name, "th"));
  state.purchases.sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  state.sales.sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  state.payments.sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  renderAll();
}

function productName(id) {
  return state.products.find(p => p.id === id)?.name || "-";
}
function customerName(id) {
  if (!id) return "เงินสดทั่วไป";
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

function renderAll() {
  renderSelects();
  renderDashboard();
  renderProducts();
  renderCustomers();
  renderHistories();
  renderReports();
  updateSalePreview();
}

function renderSelects() {
  setOptions("purchaseProduct", state.products, "เลือกสินค้า", p => `${p.name} (${money(p.stockQty)} ${p.unit || ""})`);
  setOptions("saleProduct", state.products, "เลือกสินค้า", p => `${p.name} | เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("saleCustomer", state.customers, "เงินสดทั่วไป / ไม่ระบุลูกค้า", c => `${c.name} (${c.type || "ทั่วไป"})`);
  setOptions("paymentCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} | ค้าง ${money(customerBalance(c.id))}`);
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
    <div class="list-item"><div><strong>${p.name}</strong><small>ขั้นต่ำ ${money(p.minStock)} ${p.unit || ""}</small></div><div class="money negative">${money(p.stockQty)}</div></div>
  `).join("") : `<div class="list-item">ยังไม่มีสินค้าสต็อกต่ำ</div>`;

  const debtors = state.customers.map(c => ({...c, balance: customerBalance(c.id)})).filter(c => c.balance > 0);
  $("creditList").innerHTML = debtors.length ? debtors.map(c => `
    <div class="list-item"><div><strong>${c.name}</strong><small>${c.type || "ทั่วไป"} ${c.phone ? "• " + c.phone : ""}</small></div><div class="money negative">${money(c.balance)}</div></div>
  `).join("") : `<div class="list-item">ยังไม่มีลูกหนี้ค้างชำระ</div>`;
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
        <button class="small-btn" onclick="editProduct('${p.id}')">แก้ไข</button>
        <button class="small-btn small-danger" onclick="deleteProduct('${p.id}')">ลบ</button>
      </div></td>
    </tr>
  `).join("");
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
        <button class="small-btn" onclick="editCustomer('${c.id}')">แก้ไข</button>
        <button class="small-btn small-danger" onclick="deleteCustomer('${c.id}')">ลบ</button>
      </div></td>
    </tr>`;
  }).join("");
}

function renderHistories() {
  $("purchaseHistory").innerHTML = state.purchases.slice(0, 20).map(p => `
    <div class="list-item">
      <div>
        <strong>${productName(p.productId)}</strong>
        <small>${p.date} • ${money(p.qty)} × ${money(p.unitCost)} ${p.note ? "• " + p.note : ""}</small>
      </div>
      <div class="row-actions">
        <div class="money">${money(p.totalCost)}</div>
        <button class="small-btn small-danger" onclick="deletePurchase('${p.id}')">ลบ</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">ยังไม่มีประวัติซื้อเข้า</div>`;

  $("saleHistory").innerHTML = state.sales.slice(0, 20).map(s => `
    <div class="list-item">
      <div>
        <strong>${productName(s.productId)}</strong>
        <small>${s.date} • ${customerName(s.customerId)} • ${s.paymentType === "credit" ? "เครดิต" : "เงินสด"} • ${money(s.qty)} ชิ้น</small>
      </div>
      <div class="row-actions">
        <div>
          <div class="money">${money(s.revenue)}</div>
          <small class="${Number(s.profit) >= 0 ? "positive" : "negative"}">กำไร ${money(s.profit)}</small>
        </div>
        <button class="small-btn small-danger" onclick="deleteSale('${s.id}')">ลบ</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">ยังไม่มีประวัติขาย</div>`;

  $("paymentHistory").innerHTML = state.payments.slice(0, 20).map(p => `
    <div class="list-item">
      <div>
        <strong>${customerName(p.customerId)}</strong>
        <small>${p.date} • ${p.method || ""} ${p.note ? "• " + p.note : ""}</small>
      </div>
      <div class="row-actions">
        <div class="money positive">${money(p.amount)}</div>
        <button class="small-btn small-danger" onclick="deletePayment('${p.id}')">ลบ</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">ยังไม่มีประวัติรับชำระ</div>`;
}

function renderReports() {
  $("reportSalesTable").innerHTML = state.sales.map(s => {
    const paid = s.paymentType === "cash" ? "ชำระแล้ว" : (Number(s.paidAmount || 0) >= Number(s.revenue || 0) ? "ชำระแล้ว" : "เครดิต");
    return `<tr>
      <td>${s.date}</td><td>${customerName(s.customerId)}</td><td>${productName(s.productId)}</td><td>${money(s.qty)}</td>
      <td>${money(s.revenue)}</td><td>${money(s.cost)}</td><td class="${Number(s.profit) >= 0 ? "positive" : "negative"}">${money(s.profit)}</td><td>${paid}</td>
      <td><button class="small-btn small-danger" onclick="deleteSale('${s.id}')">ลบ</button></td>
    </tr>`;
  }).join("");
}

function switchTab(tabId) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === tabId));
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.openTab)));

["purchaseDate","saleDate","paymentDate"].forEach(id => $(id).value = today());

$("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("productId").value || uid();
  const existing = state.products.find(p => p.id === id) || {};
  const item = {
    ...existing,
    id,
    name: $("productName").value.trim(),
    unit: $("productUnit").value.trim(),
    retailPrice: Number($("productRetailPrice").value || 0),
    wholesalePrice: Number($("productWholesalePrice").value || 0),
    minStock: Number($("productMinStock").value || 0),
    note: $("productNote").value.trim(),
    stockQty: Number(existing.stockQty || 0),
    avgCost: Number(existing.avgCost || 0),
    updatedAt: new Date().toISOString()
  };
  await put("products", item);
  $("productForm").reset();
  $("productId").value = "";
  $("productRetailPrice").value = 0; $("productWholesalePrice").value = 0; $("productMinStock").value = 0;
  showToast("บันทึกสินค้าแล้ว");
  await refreshState();
});

$("resetProductForm").addEventListener("click", () => {
  $("productForm").reset(); $("productId").value = "";
  $("productRetailPrice").value = 0; $("productWholesalePrice").value = 0; $("productMinStock").value = 0;
});

window.editProduct = (id) => {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  $("productId").value = p.id;
  $("productName").value = p.name || "";
  $("productUnit").value = p.unit || "";
  $("productRetailPrice").value = p.retailPrice || 0;
  $("productWholesalePrice").value = p.wholesalePrice || 0;
  $("productMinStock").value = p.minStock || 0;
  $("productNote").value = p.note || "";
  switchTab("products");
};

window.deleteProduct = async (id) => {
  const used = state.purchases.some(x => x.productId === id) || state.sales.some(x => x.productId === id);
  if (used) return alert("สินค้านี้มีประวัติซื้อ/ขายแล้ว ยังไม่ควรลบ ให้แก้ชื่อหรือเลิกใช้งานแทน");
  if (confirm("ลบสินค้านี้ใช่ไหม?")) {
    await remove("products", id);
    await refreshState();
  }
};

$("customerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("customerId").value || uid();
  const existing = state.customers.find(c => c.id === id) || {};
  const item = {
    ...existing,
    id,
    name: $("customerName").value.trim(),
    type: $("customerType").value,
    phone: $("customerPhone").value.trim(),
    creditLimit: Number($("customerCreditLimit").value || 0),
    creditDays: Number($("customerCreditDays").value || 0),
    note: $("customerNote").value.trim(),
    updatedAt: new Date().toISOString()
  };
  await put("customers", item);
  $("customerForm").reset(); $("customerId").value = ""; $("customerCreditLimit").value = 0; $("customerCreditDays").value = 0;
  showToast("บันทึกลูกค้าแล้ว");
  await refreshState();
});

$("resetCustomerForm").addEventListener("click", () => {
  $("customerForm").reset(); $("customerId").value = ""; $("customerCreditLimit").value = 0; $("customerCreditDays").value = 0;
});

window.editCustomer = (id) => {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  $("customerId").value = c.id;
  $("customerName").value = c.name || "";
  $("customerType").value = c.type || "ทั่วไป";
  $("customerPhone").value = c.phone || "";
  $("customerCreditLimit").value = c.creditLimit || 0;
  $("customerCreditDays").value = c.creditDays || 0;
  $("customerNote").value = c.note || "";
  switchTab("customers");
};

window.deleteCustomer = async (id) => {
  const used = state.sales.some(x => x.customerId === id) || state.payments.some(x => x.customerId === id);
  if (used) return alert("ลูกค้านี้มีประวัติขาย/รับชำระแล้ว ยังไม่ควรลบ ให้แก้ชื่อแทน");
  if (confirm("ลบลูกค้านี้ใช่ไหม?")) {
    await remove("customers", id);
    await refreshState();
  }
};

$("purchaseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const productId = $("purchaseProduct").value;
  const product = state.products.find(p => p.id === productId);
  if (!product) return alert("กรุณาเลือกสินค้า");
  const qty = Number($("purchaseQty").value || 0);
  const unitCost = Number($("purchaseUnitCost").value || 0);
  const extraCost = Number($("purchaseExtraCost").value || 0);
  const totalCost = (qty * unitCost) + extraCost;
  const oldStock = Number(product.stockQty || 0);
  const oldValue = oldStock * Number(product.avgCost || 0);
  const newStock = oldStock + qty;
  const newAvg = newStock > 0 ? (oldValue + totalCost) / newStock : 0;

  await put("purchases", {
    id: uid(), date: $("purchaseDate").value, productId, qty, unitCost, extraCost, totalCost,
    note: $("purchaseNote").value.trim(), createdAt: new Date().toISOString()
  });
  await put("products", { ...product, stockQty: newStock, avgCost: newAvg, updatedAt: new Date().toISOString() });

  $("purchaseForm").reset(); $("purchaseDate").value = today(); $("purchaseExtraCost").value = 0;
  showToast("บันทึกซื้อเข้าแล้ว");
  await refreshState();
});

function updateSalePreview() {
  const product = state.products.find(p => p.id === $("saleProduct").value);
  const qty = Number($("saleQty").value || 0);
  const price = Number($("saleUnitPrice").value || 0);
  const revenue = qty * price;
  const cost = qty * Number(product?.avgCost || 0);
  $("salePreviewRevenue").textContent = money(revenue);
  $("salePreviewCost").textContent = money(cost);
  $("salePreviewProfit").textContent = money(revenue - cost);
}
["saleProduct", "saleQty", "saleUnitPrice"].forEach(id => $(id).addEventListener("input", updateSalePreview));

$("saleProduct").addEventListener("change", () => {
  const p = state.products.find(x => x.id === $("saleProduct").value);
  if (p && !$("saleUnitPrice").value) $("saleUnitPrice").value = p.retailPrice || p.wholesalePrice || 0;
  updateSalePreview();
});

$("salePaymentType").addEventListener("change", () => {
  if ($("salePaymentType").value === "cash") {
    const qty = Number($("saleQty").value || 0);
    const price = Number($("saleUnitPrice").value || 0);
    $("salePaidAmount").value = qty * price;
  } else {
    $("salePaidAmount").value = 0;
  }
});

$("saleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const product = state.products.find(p => p.id === $("saleProduct").value);
  if (!product) return alert("กรุณาเลือกสินค้า");
  const qty = Number($("saleQty").value || 0);
  if (qty > Number(product.stockQty || 0)) return alert(`สต็อกไม่พอ เหลือ ${money(product.stockQty)} ${product.unit || ""}`);
  const paymentType = $("salePaymentType").value;
  const customerId = $("saleCustomer").value;
  if (paymentType === "credit" && !customerId) return alert("ขายเครดิตต้องเลือกลูกค้า");

  const unitPrice = Number($("saleUnitPrice").value || 0);
  const revenue = qty * unitPrice;
  const cost = qty * Number(product.avgCost || 0);
  const profit = revenue - cost;
  let paidAmount = Number($("salePaidAmount").value || 0);
  if (paymentType === "cash") paidAmount = revenue;
  if (paidAmount > revenue) return alert("รับเงินแล้วห้ามมากกว่ายอดขาย");

  const sale = {
    id: uid(), date: $("saleDate").value, customerId: customerId || "", productId: product.id,
    qty, unitPrice, revenue, cost, profit, paymentType, paidAmount,
    note: $("saleNote").value.trim(), createdAt: new Date().toISOString()
  };

  await put("sales", sale);
  await put("products", { ...product, stockQty: Number(product.stockQty || 0) - qty, updatedAt: new Date().toISOString() });
  $("saleForm").reset(); $("saleDate").value = today(); $("salePaidAmount").value = 0;
  showToast("บันทึกขายแล้ว");
  await refreshState();
});

$("paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const customerId = $("paymentCustomer").value;
  const amount = Number($("paymentAmount").value || 0);
  if (!customerId) return alert("กรุณาเลือกลูกค้า");
  if (amount <= 0) return alert("กรุณาระบุจำนวนเงิน");
  await put("payments", {
    id: uid(), date: $("paymentDate").value, customerId, amount,
    method: $("paymentMethod").value, note: $("paymentNote").value.trim(),
    createdAt: new Date().toISOString()
  });
  $("paymentForm").reset(); $("paymentDate").value = today();
  showToast("บันทึกรับชำระแล้ว");
  await refreshState();
});


async function rebuildInventoryFromTransactions() {
  const products = await getAll("products");
  const purchases = await getAll("purchases");
  const sales = await getAll("sales");

  const productMap = new Map();
  products.forEach(p => {
    productMap.set(p.id, { ...p, stockQty: 0, avgCost: 0 });
  });

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
      updatedSales.push({
        ...cleanSale,
        cost,
        profit,
        recalculatedAt: new Date().toISOString()
      });
    }
  }

  for (const product of productMap.values()) {
    await put("products", {
      ...product,
      stockQty: Number(product.stockQty || 0),
      avgCost: Number(product.avgCost || 0),
      updatedAt: new Date().toISOString()
    });
  }

  for (const sale of updatedSales) {
    await put("sales", sale);
  }
}

window.deletePurchase = async (id) => {
  const item = state.purchases.find(x => x.id === id);
  if (!item) return;
  const ok = confirm(`ลบรายการซื้อเข้า?\n\nสินค้า: ${productName(item.productId)}\nวันที่: ${item.date}\nจำนวน: ${money(item.qty)}\n\nระบบจะคำนวณสต็อกและต้นทุนใหม่`);
  if (!ok) return;

  await remove("purchases", id);
  await rebuildInventoryFromTransactions();
  await refreshState();
  showToast("ลบรายการซื้อเข้าแล้ว");
};

window.deleteSale = async (id) => {
  const item = state.sales.find(x => x.id === id);
  if (!item) return;
  const ok = confirm(`ลบรายการขาย?\n\nสินค้า: ${productName(item.productId)}\nลูกค้า: ${customerName(item.customerId)}\nวันที่: ${item.date}\nยอดขาย: ${money(item.revenue)} บาท\n\nระบบจะคืนสต็อกและคำนวณกำไร/ลูกหนี้ใหม่`);
  if (!ok) return;

  await remove("sales", id);
  await rebuildInventoryFromTransactions();
  await refreshState();
  showToast("ลบรายการขายแล้ว");
};

window.deletePayment = async (id) => {
  const item = state.payments.find(x => x.id === id);
  if (!item) return;
  const ok = confirm(`ลบรายการรับชำระ?\n\nลูกค้า: ${customerName(item.customerId)}\nวันที่: ${item.date}\nจำนวนเงิน: ${money(item.amount)} บาท\n\nยอดลูกหนี้จะถูกคำนวณใหม่`);
  if (!ok) return;

  await remove("payments", id);
  await refreshState();
  showToast("ลบรายการรับชำระแล้ว");
};


function download(filename, content, type="application/octet-stream") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

$("exportBackupBtn").addEventListener("click", () => {
  const data = { app: "Mini Stock Credit", version: 1, exportedAt: new Date().toISOString(), ...state };
  download(`mini-stock-credit-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
});

$("importBackupInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  if (!confirm("นำเข้า Backup จะเขียนข้อมูลทับในเครื่องนี้ ต้องการทำต่อไหม?")) return;
  for (const store of STORES) await clearStore(store);
  for (const store of STORES) {
    for (const item of (data[store] || [])) await put(store, item);
  }
  showToast("นำเข้า Backup แล้ว");
  await refreshState();
});

$("exportCsvBtn").addEventListener("click", () => {
  const rows = [["วันที่","ลูกค้า","สินค้า","จำนวน","ราคาต่อหน่วย","ยอดขาย","ต้นทุน","กำไร","ประเภทชำระ","รับแล้ว"]];
  state.sales.forEach(s => rows.push([
    s.date, customerName(s.customerId), productName(s.productId), s.qty, s.unitPrice, s.revenue, s.cost, s.profit,
    s.paymentType === "credit" ? "เครดิต" : "เงินสด", s.paidAmount
  ]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  download(`sales-report-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
});

$("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("ยืนยันล้างข้อมูลทั้งหมด? แนะนำให้ Export Backup ก่อน")) return;
  for (const store of STORES) await clearStore(store);
  await refreshState();
  showToast("ล้างข้อมูลแล้ว");
});

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
  await refreshState();
})();
