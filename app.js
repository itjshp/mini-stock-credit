const DB_NAME = "khaikhong-v2-db";
const DB_VERSION = 6;
const STORES = ["products","customers","bills","bill_items","payments","stock_movements","stock_lots","bill_item_lots","returns","return_items","stock_counts","stock_count_items","close_periods","activity_logs","settings"];

let db;
let state = { products: [], customers: [], bills: [], bill_items: [], payments: [], stock_movements: [], stock_lots: [], bill_item_lots: [], returns: [], return_items: [], stock_counts: [], stock_count_items: [], close_periods: [], activity_logs: [], settings: [] };
let cart = [];
let selectedLedgerCustomerId = "";
let selectedCustomerDetailId = "";
let selectedProductId = "";
let selectedBillId = "";
let selectedStockCountId = "";
let stockCountDraft = {};
let currentNumberInput = null;
let numberPadValue = "";
let deferredPrompt = null;
const PIN_LOCK_DISABLED = true; // v2.3.12: ปิด PIN Lock ชั่วคราวเพื่อไม่ให้ผู้ใช้ติดหน้าล็อกในช่วง Beta

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
  state.stock_lots.sort((a, b) => `${a.date || ""} ${a.createdAt || ""}`.localeCompare(`${b.date || ""} ${b.createdAt || ""}`));
  state.bill_item_lots.sort((a, b) => `${a.billId || ""} ${a.productId || ""}`.localeCompare(`${b.billId || ""} ${b.productId || ""}`));
  state.returns.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.return_items.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.stock_counts.sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
  state.stock_count_items.sort((a, b) => `${a.stockCountId || ""} ${a.productId || ""}`.localeCompare(`${b.stockCountId || ""} ${b.productId || ""}`));
  state.close_periods.sort((a, b) => `${b.lockUntil || ""} ${b.createdAt || ""}`.localeCompare(`${a.lockUntil || ""} ${a.createdAt || ""}`));
  state.activity_logs.sort((a, b) => `${b.createdAt || ""}`.localeCompare(`${a.createdAt || ""}`));
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


function productCategories() {
  return [...new Set(activeProducts()
    .map(p => (p.category || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "th"));
}

function setCategoryOptions(id, includeAll = true) {
  const el = $(id);
  if (!el) return;
  const cur = el.value;
  const options = productCategories().map(c => `<option value="${c}">${c}</option>`).join("");
  el.innerHTML = `${includeAll ? '<option value="">ทุกหมวดหมู่</option>' : '<option value="">ไม่ระบุหมวดหมู่</option>'}${options}`;
  if ([...el.options].some(o => o.value === cur)) el.value = cur;
}

function productCategoryLabel(p) {
  return (p?.category || "").trim() || "ไม่ระบุ";
}


function lotSortValue(x) {
  return `${x.date || ""} ${x.createdAt || ""} ${x.id || ""}`;
}

function productLots(productId, includeEmpty = false) {
  return (state.stock_lots || [])
    .filter(l => l.productId === productId && (includeEmpty || Number(l.remainingQty || 0) > 0.000001))
    .sort((a, b) => lotSortValue(a).localeCompare(lotSortValue(b)));
}

function itemLotUsages(billItemId) {
  return (state.bill_item_lots || [])
    .filter(x => x.billItemId === billItemId)
    .sort((a, b) => `${a.lotDate || ""} ${a.createdAt || ""}`.localeCompare(`${b.lotDate || ""} ${b.createdAt || ""}`));
}

function lotLabel(lot) {
  if (!lot) return "ไม่พบล็อต";
  return lot.lotNo || `${lot.date || "-"} @ ${money(lot.unitCost || 0)}`;
}

function fifoCostEstimate(productId, qty) {
  let need = Number(qty || 0);
  if (need <= 0) return 0;
  const p = productById(productId);
  const lots = productLots(productId).map(l => ({ ...l }));
  let cost = 0;

  for (const lot of lots) {
    if (need <= 0) break;
    const take = Math.min(need, Number(lot.remainingQty || 0));
    cost += take * Number(lot.unitCost || 0);
    need -= take;
  }

  if (need > 0) cost += need * Number(p?.avgCost || 0);
  return cost;
}

function fifoUnitCostEstimate(productId, qty) {
  const q = Number(qty || 0);
  return q > 0 ? fifoCostEstimate(productId, q) / q : 0;
}

function refreshCartItemFifoCost(item) {
  if (!item) return item;
  item.unitCost = fifoUnitCostEstimate(item.productId, item.qty);
  item.fifoCostEstimate = Number(item.qty || 0) * Number(item.unitCost || 0);
  return item;
}

function refreshCartFifoCosts() {
  cart = cart.map(item => refreshCartItemFifoCost(item));
}

function billItemLotBreakdownText(itemId) {
  const rows = itemLotUsages(itemId);
  if (!rows.length) return "";
  return rows.map(r => `${money(r.qty)} x ${money(r.unitCost)} (${r.lotNo || r.lotDate || "FIFO"})`).join(" • ");
}

function billItemLotBreakdownHtml(item) {
  const text = billItemLotBreakdownText(item.id);
  if (text) return `<small class="fifo-breakdown">FIFO: ${text}</small>`;
  return `<small class="fifo-muted">FIFO: ใช้ต้นทุน ${money(item.unitCost || 0)} ต่อหน่วย</small>`;
}

function renderProductLotsHtml(productId) {
  const p = productById(productId);
  const lots = productLots(productId, true);
  const openLots = lots.filter(l => Number(l.remainingQty || 0) > 0.000001);
  const fifoValue = openLots.reduce((sum, l) => sum + Number(l.remainingQty || 0) * Number(l.unitCost || 0), 0);

  return `
    <div class="panel fifo-lot-panel">
      <div class="panel-head">
        <div>
          <h3>ล็อตต้นทุน FIFO คงเหลือ</h3>
          <span class="hint">ระบบจะขายจากล็อตที่รับเข้าก่อนโดยอัตโนมัติ</span>
        </div>
        <span class="fifo-lot-chip">มูลค่าคงเหลือ ${money(fifoValue)} บาท</span>
      </div>
      <div class="stack-list">
        ${openLots.map(l => `
          <div class="list-item fifo-lot-row">
            <div>
              <strong>${l.lotNo || "FIFO Lot"}</strong>
              <small>${l.date || "-"} • ${l.sourceType || "-"} • ${l.note || "-"}</small>
              <small>รับเข้า ${money(l.originalQty)} ${p?.unit || ""} • ใช้ไป ${money(Number(l.originalQty || 0) - Number(l.remainingQty || 0))} ${p?.unit || ""}</small>
            </div>
            <div>
              <div class="money">${money(l.remainingQty)} ${p?.unit || ""}</div>
              <small>ทุน ${money(l.unitCost)} / ${p?.unit || ""}</small>
            </div>
          </div>
        `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">📦</div><strong>ยังไม่มีล็อตคงเหลือ</strong><small>ซื้อเข้า/Import สต็อกเริ่มต้นเพื่อสร้างล็อต FIFO</small></div></div>`}
      </div>
    </div>
  `;
}

function productById(id) {
  return state.products.find(p => p.id === id);
}

function billItems(billId) {
  return state.bill_items.filter(i => i.billId === billId);
}



function activeClosePeriods() {
  return (state.close_periods || [])
    .filter(p => p.status !== "reopened")
    .sort((a, b) => `${b.lockUntil || ""} ${b.createdAt || ""}`.localeCompare(`${a.lockUntil || ""} ${a.createdAt || ""}`));
}

function currentLockPeriod() {
  return activeClosePeriods()[0] || null;
}

function currentLockDate() {
  return currentLockPeriod()?.lockUntil || "";
}

function isDateLocked(date) {
  const lock = currentLockDate();
  return !!(date && lock && String(date) <= String(lock));
}

function assertDateUnlocked(date, action = "ทำรายการ") {
  if (!isDateLocked(date)) return true;
  const p = currentLockPeriod();
  alert(`${action}ไม่ได้\n\nวันที่ ${date} อยู่ในรอบที่ปิดแล้ว\nระบบล็อกข้อมูลถึงวันที่ ${currentLockDate()}${p?.closeNo ? ` (${p.closeNo})` : ""}\n\nหากจำเป็นต้องแก้ไข ให้ไปที่ เพิ่มเติม > ปิดรอบ / ล็อกย้อนหลัง แล้วปลดล็อกก่อน`);
  return false;
}

function periodEndOfMonth(dateText = today()) {
  const d = new Date(dateText);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function closePeriodStats(lockUntil) {
  const bills = state.bills.filter(b => b.status !== "cancelled" && (!lockUntil || b.date <= lockUntil));
  const payments = state.payments.filter(p => !lockUntil || p.date <= lockUntil);
  const returns = (state.returns || []).filter(r => !lockUntil || r.date <= lockUntil);
  const purchases = state.stock_movements.filter(m => m.type === "purchase" && (!lockUntil || m.date <= lockUntil));

  return {
    billCount: bills.length,
    sales: bills.reduce((s, b) => s + Number(b.subtotal || 0), 0),
    cost: bills.reduce((s, b) => s + Number(b.costTotal || 0), 0),
    profit: bills.reduce((s, b) => s + Number(b.profitTotal || 0), 0),
    credit: bills.reduce((s, b) => s + Number(b.creditAmount || 0), 0),
    payments: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    purchaseValue: purchases.reduce((s, m) => s + Number(m.qtyIn || 0) * Number(m.unitCost || 0), 0),
    returnTotal: returns.reduce((s, r) => s + Number(r.totalRevenue || 0), 0)
  };
}

function closePeriodTypeName(type) {
  if (type === "daily") return "ปิดยอดรายวัน";
  if (type === "monthly") return "ปิดยอดรายเดือน";
  return "กำหนดเอง";
}

function returnsForBill(billId) {
  return (state.returns || []).filter(r => r.billId === billId);
}

function returnItemsForBill(billId) {
  return (state.return_items || []).filter(r => r.billId === billId);
}

function returnItemsForBillItem(billItemId) {
  return (state.return_items || []).filter(r => r.billItemId === billItemId);
}

function returnedQtyForItem(billItemId) {
  return returnItemsForBillItem(billItemId).reduce((sum, r) => sum + Number(r.qty || 0), 0);
}

function remainingReturnQty(item) {
  return Math.max(0, Number(item.qty || 0) - returnedQtyForItem(item.id));
}

function returnTotalsForBill(billId) {
  const rows = returnItemsForBill(billId);
  return {
    qty: rows.reduce((sum, r) => sum + Number(r.qty || 0), 0),
    revenue: rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0),
    cost: rows.reduce((sum, r) => sum + Number(r.cost || 0), 0),
    count: rows.length
  };
}

function itemReturnUnitRevenue(item) {
  return Number(item.qty || 0) > 0 ? Number(item.revenue || 0) / Number(item.qty || 0) : 0;
}

function itemReturnUnitCost(item) {
  return Number(item.qty || 0) > 0 ? Number(item.cost || 0) / Number(item.qty || 0) : Number(item.unitCost || 0);
}

function billReturnSummaryText(billId) {
  const totals = returnTotalsForBill(billId);
  if (!totals.count) return "";
  return `คืนสินค้า ${totals.count} รายการ • ยอดคืน ${money(totals.revenue)} บาท`;
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
    .sort((a, b) => `${a.date || ""} ${a.createdAt || ""} ${a.id || ""}`.localeCompare(`${b.date || ""} ${b.createdAt || ""} ${b.id || ""}`));
  const items = await getAll("bill_items");
  const bills = await getAll("bills");

  const lotsByProduct = new Map(products.map(p => [p.id, []]));
  const netQty = new Map(products.map(p => [p.id, 0]));
  const newLots = [];
  const newUsages = [];
  const itemsToUpdate = new Map();
  const saleUsageByBillProduct = new Map();

  const productMap = new Map(products.map(p => [p.id, p]));
  const billMap = new Map(bills.map(b => [b.id, b]));

  function pushLot({ productId, qty, unitCost, movement, sourceType, note, originLotId = "" }) {
    const q = Number(qty || 0);
    if (q <= 0) return null;

    const list = lotsByProduct.get(productId) || [];
    const lotNo = `${sourceType || movement?.type || "LOT"}-${String(list.length + 1).padStart(4, "0")}`;
    const lot = {
      id: uid(),
      productId,
      lotNo,
      sourceType: sourceType || movement?.type || "lot",
      sourceId: movement?.id || "",
      refId: movement?.refId || "",
      originLotId,
      date: movement?.date || today(),
      originalQty: q,
      remainingQty: q,
      unitCost: Number(unitCost || 0),
      note: note || movement?.note || "",
      createdAt: movement?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.push(lot);
    lotsByProduct.set(productId, list);
    newLots.push(lot);
    return lot;
  }

  function allocateFifo(productId, qty, movement) {
    let need = Number(qty || 0);
    const allocations = [];
    const lots = (lotsByProduct.get(productId) || [])
      .sort((a, b) => `${a.date || ""} ${a.createdAt || ""} ${a.id || ""}`.localeCompare(`${b.date || ""} ${b.createdAt || ""} ${b.id || ""}`));

    for (const lot of lots) {
      if (need <= 0) break;
      const remain = Number(lot.remainingQty || 0);
      if (remain <= 0) continue;

      const take = Math.min(need, remain);
      lot.remainingQty = remain - take;
      lot.updatedAt = new Date().toISOString();
      allocations.push({
        lotId: lot.id,
        lotNo: lot.lotNo,
        lotDate: lot.date,
        qty: take,
        unitCost: Number(lot.unitCost || 0),
        cost: take * Number(lot.unitCost || 0),
        originLotId: lot.originLotId || ""
      });
      need -= take;
    }

    if (need > 0.000001) {
      const p = productMap.get(productId);
      const fallbackCost = Number(movement?.unitCost || p?.avgCost || 0);
      allocations.push({
        lotId: "",
        lotNo: "SHORTAGE/FALLBACK",
        lotDate: movement?.date || "",
        qty: need,
        unitCost: fallbackCost,
        cost: need * fallbackCost,
        originLotId: ""
      });
    }

    return allocations;
  }

  function rememberSaleUsage(billId, productId, usage) {
    const key = `${billId}|${productId}`;
    const rows = saleUsageByBillProduct.get(key) || [];
    rows.push(usage);
    saleUsageByBillProduct.set(key, rows);
  }

  for (const m of movements) {
    const productId = m.productId;
    if (!productMap.has(productId)) continue;

    const inQty = Number(m.qtyIn || 0);
    const outQty = Number(m.qtyOut || 0);
    const currentNet = Number(netQty.get(productId) || 0);

    if (m.type === "cost_adjust") {
      const lots = lotsByProduct.get(productId) || [];
      lots.filter(l => Number(l.remainingQty || 0) > 0).forEach(l => {
        l.unitCost = Number(m.unitCost || 0);
        l.note = `${l.note || ""} | ปรับทุน ${m.date || ""}`.trim();
        l.updatedAt = new Date().toISOString();
      });
      continue;
    }

    if (inQty > 0) {
      netQty.set(productId, currentNet + inQty);

      if (m.type === "sale_cancel" && m.refId) {
        const key = `${m.refId}|${productId}`;
        const originalUsages = saleUsageByBillProduct.get(key) || [];
        let remainingReturn = inQty;

        for (const u of originalUsages) {
          if (remainingReturn <= 0) break;
          const q = Math.min(Number(u.qty || 0), remainingReturn);
          pushLot({
            productId,
            qty: q,
            unitCost: Number(u.unitCost || 0),
            movement: m,
            sourceType: "return",
            note: `คืนจากยกเลิกบิล ${billMap.get(m.refId)?.billNo || ""}`,
            originLotId: u.lotId || ""
          });
          remainingReturn -= q;
        }

        if (remainingReturn > 0.000001) {
          pushLot({
            productId,
            qty: remainingReturn,
            unitCost: Number(m.unitCost || 0),
            movement: m,
            sourceType: "return",
            note: m.note || "คืนจากยกเลิกบิล"
          });
        }
      } else {
        pushLot({
          productId,
          qty: inQty,
          unitCost: Number(m.unitCost || 0),
          movement: m,
          sourceType: m.type || "in",
          note: m.note || ""
        });
      }

      continue;
    }

    if (outQty > 0) {
      netQty.set(productId, currentNet - outQty);
      const allocations = allocateFifo(productId, outQty, m);

      if (m.type === "sale" && m.refType === "bill" && m.refId) {
        const saleItems = items.filter(item => item.billId === m.refId && item.productId === productId);
        let queue = allocations.map(a => ({ ...a }));

        for (const item of saleItems) {
          let need = Number(item.qty || 0);
          const itemUsages = [];

          while (need > 0.000001 && queue.length) {
            const first = queue[0];
            const take = Math.min(need, Number(first.qty || 0));
            const usage = {
              id: uid(),
              billId: item.billId,
              billItemId: item.id,
              productId: item.productId,
              lotId: first.lotId,
              lotNo: first.lotNo,
              lotDate: first.lotDate,
              qty: take,
              unitCost: Number(first.unitCost || 0),
              cost: take * Number(first.unitCost || 0),
              createdAt: new Date().toISOString()
            };
            itemUsages.push(usage);
            newUsages.push(usage);
            rememberSaleUsage(item.billId, item.productId, usage);

            first.qty = Number(first.qty || 0) - take;
            need -= take;
            if (first.qty <= 0.000001) queue.shift();
          }

          const itemCost = itemUsages.reduce((sum, u) => sum + Number(u.cost || 0), 0);
          const unitCost = Number(item.qty || 0) > 0 ? itemCost / Number(item.qty || 0) : Number(item.unitCost || 0);
          const revenue = Number(item.revenue || 0);
          itemsToUpdate.set(item.id, {
            ...item,
            unitCost,
            cost: itemCost,
            fifoCostMode: true,
            fifoUpdatedAt: new Date().toISOString(),
            profit: revenue - itemCost
          });
        }
      }

      // บันทึก unitCost ของ stock movement เป็น weighted cost ของการตัด FIFO
      const moveCost = allocations.reduce((sum, a) => sum + Number(a.cost || 0), 0);
      const moveUnitCost = outQty > 0 ? moveCost / outQty : Number(m.unitCost || 0);
      if (m.type === "sale" || m.type === "adjust_out") {
        await put("stock_movements", { ...m, unitCost: moveUnitCost, updatedAt: new Date().toISOString() });
      }
    }
  }

  await clearStore("stock_lots");
  await clearStore("bill_item_lots");

  for (const lot of newLots) await put("stock_lots", lot);
  for (const usage of newUsages) await put("bill_item_lots", usage);
  for (const item of itemsToUpdate.values()) await put("bill_items", item);

  const lotSummary = new Map();
  for (const lot of newLots) {
    if (Number(lot.remainingQty || 0) <= 0) continue;
    const cur = lotSummary.get(lot.productId) || { qty: 0, value: 0 };
    cur.qty += Number(lot.remainingQty || 0);
    cur.value += Number(lot.remainingQty || 0) * Number(lot.unitCost || 0);
    lotSummary.set(lot.productId, cur);
  }

  for (const p of products) {
    const summary = lotSummary.get(p.id) || { qty: 0, value: 0 };
    const movementQty = Number(netQty.get(p.id) || 0);
    const avgCost = summary.qty > 0 ? summary.value / summary.qty : Number(p.avgCost || 0);
    await put("products", {
      ...p,
      stockQty: movementQty,
      avgCost,
      costMethod: "FIFO",
      updatedAt: new Date().toISOString()
    });
  }

  await recalcBills();
}

async function rebuildCostSnapshots() {
  await recomputeInventory();
}

async function recalcBills() {
  const bills = await getAll("bills");
  const items = await getAll("bill_items");
  const payments = await getAll("payments");
  const returnItems = await getAll("return_items");

  for (const b of bills) {
    const its = items.filter(i => i.billId === b.id);
    const ret = returnItems.filter(r => r.billId === b.id);

    const originalGrossTotal = its.reduce((s, i) => s + Number(i.grossRevenue ?? (Number(i.qty || 0) * Number(i.unitPrice || 0))), 0);
    const itemDiscountTotal = its.reduce((s, i) => s + Number(i.discount || 0), 0);
    const originalLineSubtotal = its.reduce((s, i) => s + Number(i.revenue || 0), 0);
    const billDiscount = Math.min(Math.max(Number(b.billDiscount || 0), 0), Math.max(0, originalLineSubtotal));
    const originalSubtotal = Math.max(0, originalLineSubtotal - billDiscount);
    const originalCostTotal = its.reduce((s, i) => s + Number(i.cost || 0), 0);

    const returnTotal = ret.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const returnCostTotal = ret.reduce((s, r) => s + Number(r.cost || 0), 0);

    b.originalGrossTotal = originalGrossTotal;
    b.originalSubtotal = originalSubtotal;
    b.originalCostTotal = originalCostTotal;
    b.returnTotal = returnTotal;
    b.returnCostTotal = returnCostTotal;
    b.hasReturns = returnTotal > 0 || ret.length > 0;

    b.grossTotal = Math.max(0, originalGrossTotal - returnTotal);
    b.itemDiscountTotal = itemDiscountTotal;
    b.billDiscount = billDiscount;
    b.discountTotal = itemDiscountTotal + billDiscount;
    b.subtotal = Math.max(0, originalSubtotal - returnTotal);
    b.costTotal = Math.max(0, originalCostTotal - returnCostTotal);
    b.profitTotal = Number(b.subtotal || 0) - Number(b.costTotal || 0);

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
      b.refundDue = b.paymentType !== "credit" ? Math.max(0, Number(b.paidAmount || 0) - Number(b.subtotal || 0)) : 0;
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
  renderCategoryOptions();
  renderSale();
  renderProducts();
  renderProductDetail();
  renderCustomers();
  renderCustomerDetail();
  renderSummary();
  renderDailyClose();
  renderLowStockCenter();
  renderMovements();
  renderClosePeriod();
  renderStockCount();
  renderAdjustments();
  renderLedger();
  renderDebtAging();
  renderPayments();
  renderOutstandingBills();
  renderReports();
  renderBillSearch();
  renderBillDetail();
  renderBackupStatus();
  renderBetaReady();
  renderSettingsUI();
  renderTestSummary();
}


function renderCategoryOptions() {
  setCategoryOptions("productCategoryFilter");
  setCategoryOptions("saleCategoryFilter");
  setCategoryOptions("stockCountCategoryFilter");
}

function renderSelects() {
  setOptions("billCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  setOptions("purchaseProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("adjustProduct", activeProducts(), "เลือกสินค้า", p => `${p.name} • เหลือ ${money(p.stockQty)} ${p.unit || ""}`);
  setOptions("paymentCustomer", state.customers, "เลือกลูกค้า", c => `${c.name} • ค้าง ${money(customerDebt(c.id))}`);
  renderPaymentBillOptions();
  setOptions("reportCustomer", state.customers, "ลูกค้าทั้งหมด", c => c.name);
  setOptions("billSearchCustomer", state.customers, "ลูกค้าทั้งหมด", c => c.name);
  setOptions("debtAgingCustomer", state.customers, "ลูกค้าทั้งหมด", c => c.name);
}


function cartLineGross(item) {
  return Number(item.qty || 0) * Number(item.unitPrice || 0);
}

function cartLineDiscount(item) {
  const gross = cartLineGross(item);
  return Math.min(Math.max(Number(item.discount || 0), 0), gross);
}

function cartLineRevenue(item) {
  return Math.max(0, cartLineGross(item) - cartLineDiscount(item));
}

function cartTotals() {
  const gross = cart.reduce((sum, item) => sum + cartLineGross(item), 0);
  const itemDiscountTotal = cart.reduce((sum, item) => sum + cartLineDiscount(item), 0);
  const maxBillDiscount = Math.max(0, gross - itemDiscountTotal);
  const billDiscount = Math.min(Math.max(Number($("billDiscount")?.value || 0), 0), maxBillDiscount);
  const subtotal = Math.max(0, gross - itemDiscountTotal - billDiscount);
  refreshCartFifoCosts();
  const cost = cart.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitCost || 0), 0);

  return {
    gross,
    itemDiscountTotal,
    billDiscount,
    discountTotal: itemDiscountTotal + billDiscount,
    subtotal,
    cost,
    profit: subtotal - cost
  };
}

window.updateCartItemDiscount = (id, value) => {
  const item = cart.find(i => i.productId === id);
  if (!item) return;
  item.discount = Math.max(0, Number(value || 0));
  renderSale();
};

function renderSale() {
  const q = ($("saleSearch")?.value || "").toLowerCase().trim();
  const category = $("saleCategoryFilter")?.value || "";
  const products = activeProducts()
    .filter(p => !category || (p.category || "") === category)
    .filter(p => !q || `${p.name} ${p.unit || ""} ${p.category || ""} ${p.note || ""}`.toLowerCase().includes(q))
    .slice(0, 24);

  $("quickProducts").innerHTML = products.map(p => `
    <button class="product-tile" onclick="addProductToCart('${p.id}')" type="button">
      <strong>${p.name}</strong>
      <small>เหลือ ${money(p.stockQty)} ${p.unit || ""} • ทุน FIFO ถัดไป ${money(fifoUnitCostEstimate(p.id, 1))}</small><span class="product-category-line">หมวดหมู่: ${productCategoryLabel(p)}</span>
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
        <span class="cart-price">${money(cartLineRevenue(item))}</span>
      </div>
      <div class="discount-input-wrap">
        <small>ราคาก่อนลด ${money(cartLineGross(item))}${cartLineDiscount(item) > 0 ? ` • <span class="discount-note">ลด ${money(cartLineDiscount(item))}</span>` : ""}</small>
        <label>ส่วนลดรายการ<input class="cart-discount-input" data-keypad="true" type="number" min="0" step="0.01" value="${Number(item.discount || 0)}" oninput="updateCartItemDiscount('${item.productId}', this.value)"></label>
      </div>
    </div>
  `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🛒</div><strong>บิลยังว่างอยู่</strong><small>แตะสินค้าเพื่อเพิ่มลงบิล</small></div></div>`;

  const totals = cartTotals();
  $("cartCount").textContent = cart.length;
  $("cartTotal").textContent = money(totals.subtotal);
  $("cartProfit").textContent = money(totals.profit);
  $("currentBillMeta").textContent = `เลขบิลถัดไป: ${nextBillNo()}`;
}

window.addProductToCart = (id) => {
  const p = productById(id);
  if (!p || p.isArchived) return;

  const exist = cart.find(i => i.productId === id);
  if (exist) { exist.qty += 1; refreshCartItemFifoCost(exist); }
  else cart.push(refreshCartItemFifoCost({ productId: id, name: p.name, unit: p.unit || "", qty: 1, unitPrice: salePriceForProduct(p), unitCost: Number(p.avgCost || 0), discount: 0 }));

  renderSale();
  showToast(`เพิ่ม ${p.name} ลงบิล`);
};

window.changeCartQty = (id, delta) => {
  const item = cart.find(i => i.productId === id);
  if (!item) return;
  item.qty = Math.max(0.01, Number(item.qty || 0) + delta);
  refreshCartItemFifoCost(item);
  renderSale();
};

window.removeCartItem = (id) => {
  cart = cart.filter(i => i.productId !== id);
  renderSale();
};

function clearCart() {
  cart = [];
  if ($("billDiscount")) $("billDiscount").value = 0;
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
  if (!assertDateUnlocked(date, "บันทึกขายย้อนหลัง")) return;
  refreshCartFifoCosts();
  const totals = cartTotals();
  const subtotal = totals.subtotal;
  const costTotal = totals.cost;
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
    grossTotal: totals.gross,
    itemDiscountTotal: totals.itemDiscountTotal,
    billDiscount: totals.billDiscount,
    discountTotal: totals.discountTotal,
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
    const grossRevenue = cartLineGross(item);
    const discount = cartLineDiscount(item);
    const revenue = cartLineRevenue(item);
    const cost = Number(item.qty || 0) * Number(item.unitCost || 0);

    await put("bill_items", {
      id: uid(),
      billId,
      productId: item.productId,
      productNameSnapshot: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost,
      grossRevenue,
      discount,
      revenue,
      cost,
      profit: revenue - cost
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
  await logActivity("SALE_CREATE", `ขายบิล ${billNo}`, { refType: "bill", refId: billId, refNo: billNo, amount: subtotal, detail: `${paymentType === "credit" ? "ขายเครดิต" : "เงินสด/โอน"} • ${cart.length} รายการ • ลูกค้า ${customerName(customerId)}` });
  clearCart();
  showToast(`บันทึกขาย ${billNo} แล้ว`);
}

async function cancelBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b || b.status === "cancelled") return;
  if (!assertDateUnlocked(b.date, "ยกเลิกบิล")) return;

  const reason = prompt(`เหตุผลการยกเลิกบิล ${b.billNo}\n\nตัวอย่าง: กรอกผิด / ลูกค้ายกเลิก / ทดสอบระบบ`, b.cancelReason || "");
  if (reason === null) return;

  const cleanReason = reason.trim();
  if (!cleanReason) return alert("กรุณาใส่เหตุผลการยกเลิก");

  if (!confirm(`ยืนยันยกเลิกบิล ${b.billNo}?\n\nเหตุผล: ${cleanReason}\n\nระบบจะคืนสต็อกให้อัตโนมัติ`)) return;

  const items = billItems(id);
  const now = new Date().toISOString();

  for (const item of items) {
    const qtyToReturn = remainingReturnQty(item);
    if (qtyToReturn <= 0) continue;
    await put("stock_movements", {
      id: uid(),
      productId: item.productId,
      type: "sale_cancel",
      refType: "bill",
      refId: id,
      date: today(),
      qtyIn: qtyToReturn,
      qtyOut: 0,
      unitCost: itemReturnUnitCost(item),
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
  await logActivity("BILL_CANCEL", `ยกเลิกบิล ${b.billNo}`, { refType: "bill", refId: id, refNo: b.billNo, amount: b.subtotal || 0, detail: cleanReason });
  showToast(`ยกเลิกบิล ${b.billNo} แล้ว`);
}

window.cancelBill = cancelBill;

function renderProducts() {
  const q = ($("productSearch")?.value || "").toLowerCase().trim();
  const category = $("productCategoryFilter")?.value || "";
  const rows = activeProducts()
    .filter(p => !category || (p.category || "") === category)
    .filter(p => !q || `${p.name} ${p.unit || ""} ${p.category || ""} ${p.note || ""}`.toLowerCase().includes(q));

  $("productsTable").innerHTML = rows.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><small>${p.unit || ""} ${p.note ? `• ${p.note}` : ""}</small></td>
      <td><span class="category-chip ${p.category ? "" : "empty"}">${productCategoryLabel(p)}</span></td>
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
  `).join("") || `<tr><td colspan="8">ยังไม่มีสินค้า</td></tr>`;
}

function resetProductForm() {
  ["productId", "productName", "productUnit", "productCategory", "productNote"].forEach(id => { if ($(id)) $(id).value = ""; });
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
  if ($("productCategory")) $("productCategory").value = p.category || "";
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
    await logActivity("PRODUCT_ARCHIVE", `ซ่อนสินค้า ${p.name}`, { refType: "product", refId: id, detail: "สินค้ามีประวัติ จึงซ่อนแทนลบ" });
    showToast("ซ่อนสินค้าแล้ว");
    return;
  }

  if (confirm(`ลบสินค้า "${p.name}" ใช่ไหม?`)) {
    await del("products", id);
    await loadState();
    await logActivity("PRODUCT_DELETE", `ลบสินค้า ${p.name}`, { refType: "product", refId: id });
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
          <small>${p.unit || "-"} • หมวดหมู่: ${productCategoryLabel(p)} ${p.note ? "• " + p.note : ""}</small>
        </div>
        <div class="row-actions">
          <button class="soft-btn" onclick="quickPurchaseProduct('${p.id}')">ซื้อเข้า</button>
          <button class="soft-btn" onclick="quickAdjustProduct('${p.id}')">ปรับสต็อก</button>
          <button class="small-btn small-edit" onclick="editProduct('${p.id}')">แก้ไข</button>
        </div>
      </div>

      <div class="product-detail-kpis">
        <div><span>สต็อกคงเหลือ</span><strong>${money(p.stockQty)} ${p.unit || ""}</strong></div>
        <div><span>ทุน FIFO เฉลี่ยคงเหลือ</span><strong>${money(p.avgCost)}</strong></div>
        <div><span>ราคาปลีก</span><strong>${money(p.price)}</strong></div><div><span>ราคาส่ง</span><strong class="wholesale-price">${money(productWholesalePrice(p))}</strong></div>
        <div><span>สถานะ</span><strong class="${lowStock ? "low" : "ok-stock"}">${lowStock ? "ใกล้หมด" : "ปกติ"}</strong></div>
        <div><span>จำนวนขาย</span><strong>${money(soldQty)} ${p.unit || ""}</strong></div>
        <div><span>ยอดขายสินค้า</span><strong>${money(soldRevenue)}</strong></div>
        <div><span>กำไรรวม</span><strong class="${productProfit >= 0 ? "positive" : "negative"}">${money(productProfit)}</strong></div>
        <div><span>จำนวนบิล</span><strong>${activeItems.length.toLocaleString("th-TH")}</strong></div>
      </div>
    </div>

    ${renderProductLotsHtml(p.id)}

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
            const isCost = m.type === "cost_adjust";
            const isIn = Number(m.qtyIn || 0) > 0;
            const cls = isCost ? "cost-adjust" : (m.type === "sale_cancel" || m.type === "sale_return" ? "product-move-cancel" : (isIn ? "product-move-in" : "product-move-out"));
            const qty = isCost ? 0 : (isIn ? Number(m.qtyIn || 0) : Number(m.qtyOut || 0));
            const label = isCost ? `ปรับทุน ${money(m.unitCost || 0)}` : `${isIn ? "+" : "-"}${money(qty)}`;
            return `
              <div class="list-item ${cls}">
                <div>
                  <strong>${m.type || "-"}</strong>
                  <small>${m.date || "-"} • ${m.note || "-"} • ทุน ${money(m.unitCost || 0)}</small>
                </div>
                <div class="money ${isCost ? "product-profit" : (isIn ? "positive" : "negative")}">${label}</div>
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
  if (!$("productDetail")) {
    alert("ไม่พบหน้ารายละเอียดสินค้า กรุณาอัปเดต index.html ให้ครบ");
    return;
  }
  switchTab("productDetail");
  try {
    renderProductDetail();
  } catch (err) {
    console.error("openProductDetail failed", err);
    const wrap = $("productDetailContent");
    if (wrap) {
      wrap.innerHTML = `<div class="panel"><div class="list-item"><div><strong>เปิดรายละเอียดสินค้าไม่ได้</strong><small>${String(err?.message || err)}</small></div></div></div>`;
    }
    alert("เปิดรายละเอียดสินค้าไม่ได้ กรุณากดตรวจ/ซ่อม FIFO หรือส่ง Feedback ให้ผู้พัฒนา");
  }
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
    await logActivity("CUSTOMER_DELETE", "ลบลูกค้า", { refType: "customer", refId: id });
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

function customerHistoryFilters() {
  return {
    from: $("customerHistoryFrom")?.value || "",
    to: $("customerHistoryTo")?.value || "",
    item: ($("customerHistoryItemSearch")?.value || "").toLowerCase().trim(),
    view: $("customerHistoryView")?.value || "overview",
    includeCancelled: !!$("customerHistoryIncludeCancelled")?.checked
  };
}

function customerHistoryBills(customerId) {
  const f = customerHistoryFilters();
  return state.bills
    .filter(b => b.customerId === customerId)
    .filter(b => f.includeCancelled || b.status !== "cancelled")
    .filter(b => !f.from || b.date >= f.from)
    .filter(b => !f.to || b.date <= f.to)
    .filter(b => {
      if (!f.item) return true;
      return billItems(b.id).some(item => `${item.productNameSnapshot || ""} ${productById(item.productId)?.name || ""}`.toLowerCase().includes(f.item));
    })
    .sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function customerHistoryItems(customerId) {
  return customerHistoryBills(customerId).flatMap(b => {
    return billItems(b.id)
      .filter(item => {
        const q = customerHistoryFilters().item;
        if (!q) return true;
        return `${item.productNameSnapshot || ""} ${productById(item.productId)?.name || ""}`.toLowerCase().includes(q);
      })
      .map(item => ({ ...item, bill: b }));
  });
}

function customerProductSummary(customerId) {
  const map = new Map();
  for (const row of customerHistoryItems(customerId)) {
    const key = row.productId || row.productNameSnapshot || "unknown";
    const current = map.get(key) || {
      productId: row.productId,
      name: row.productNameSnapshot || productById(row.productId)?.name || "-",
      qty: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      count: 0,
      lastDate: ""
    };
    current.qty += Number(row.qty || 0);
    current.revenue += Number(row.revenue || 0);
    current.cost += Number(row.cost || 0);
    current.profit += Number(row.profit || 0);
    current.count += 1;
    if (String(row.bill?.date || "") > String(current.lastDate || "")) current.lastDate = row.bill.date;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function customerHistoryStats(customerId) {
  const bills = customerHistoryBills(customerId);
  const active = bills.filter(b => b.status !== "cancelled");
  const items = customerHistoryItems(customerId).filter(item => item.bill.status !== "cancelled");
  return {
    bills,
    active,
    items,
    billCount: active.length,
    itemCount: items.length,
    sales: active.reduce((sum, b) => sum + Number(b.subtotal || 0), 0),
    cost: active.reduce((sum, b) => sum + Number(b.costTotal || 0), 0),
    profit: active.reduce((sum, b) => sum + Number(b.profitTotal || 0), 0),
    credit: active.reduce((sum, b) => sum + Number(b.creditAmount || 0), 0),
    qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0)
  };
}

function customerHistoryRangeText() {
  const f = customerHistoryFilters();
  if (f.from && f.to) return `${f.from} ถึง ${f.to}`;
  if (f.from) return `ตั้งแต่ ${f.from}`;
  if (f.to) return `ถึง ${f.to}`;
  return "ทั้งหมด";
}

function renderCustomerHistoryContent(c) {
  const f = customerHistoryFilters();
  const stats = customerHistoryStats(c.id);
  const summary = customerProductSummary(c.id);

  const summaryHtml = `
    <div class="customer-history-summary">
      <div><span>จำนวนบิล</span><strong>${stats.billCount.toLocaleString("th-TH")}</strong></div>
      <div><span>จำนวนรายการ</span><strong>${stats.itemCount.toLocaleString("th-TH")}</strong></div>
      <div><span>ยอดซื้อ</span><strong>${money(stats.sales)}</strong></div>
      <div><span>กำไร</span><strong>${money(stats.profit)}</strong></div>
      <div><span>ยอดค้าง</span><strong>${money(stats.credit)}</strong></div>
    </div>
  `;

  if (f.view === "bills") {
    return `${summaryHtml}<div class="panel"><div class="panel-head"><h3>บิลที่ซื้อ</h3><span class="hint">${customerHistoryRangeText()}</span></div><div class="stack-list">
      ${stats.bills.map(b => `
        <div class="list-item customer-purchase-row ${b.status === "cancelled" ? "cancelled" : (Number(b.creditAmount || 0) > 0 ? "credit" : "")}">
          <div>
            <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)} ${Number(b.returnTotal || 0) > 0 ? `<span class="return-chip">มีคืนสินค้า</span>` : ""}</strong>
            <small>${b.date} • ${billItems(b.id).length} รายการ • ${billItemText(b.id)}</small>
            ${Number(b.creditAmount || 0) > 0 ? `<small class="negative">ยอดค้างบิลนี้ ${money(b.creditAmount)}</small>` : ""}
          </div>
          <div class="row-actions"><div><div class="money">${money(b.subtotal)}</div><small class="${b.profitTotal >= 0 ? "positive" : "negative"}">กำไร ${money(b.profitTotal)}</small></div><button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button><button class="small-btn" onclick="copyBillText('${b.id}')">คัดลอก</button></div>
        </div>`).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🧾</div><strong>ไม่พบบิล</strong><small>ลองเปลี่ยนช่วงวันที่หรือคำค้นหา</small></div></div>`}
    </div></div>`;
  }

  if (f.view === "items") {
    return `${summaryHtml}<div class="panel"><div class="panel-head"><h3>รายการที่ซื้อ</h3><span class="hint">แยกรายการสินค้าจากทุกบิล</span></div><div class="stack-list">
      ${stats.items.map(item => `
        <div class="list-item customer-item-row">
          <div>
            <strong>${item.productNameSnapshot || productById(item.productId)?.name || "-"}</strong>
            <small>${item.bill.date} • บิล <button class="bill-link" onclick="openBillDetail('${item.bill.id}')">${item.bill.billNo}</button> • จำนวน ${money(item.qty)} • ราคา ${money(item.unitPrice)}${Number(item.discount || 0) > 0 ? ` • ลด ${money(item.discount)}` : ""}</small>
          </div>
          <div><div class="money">${money(item.revenue)}</div><small class="${item.profit >= 0 ? "positive" : "negative"}">กำไร ${money(item.profit)}</small></div>
        </div>`).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">📦</div><strong>ไม่พบรายการสินค้า</strong></div></div>`}
    </div></div>`;
  }

  if (f.view === "summary") {
    return `${summaryHtml}<div class="panel"><div class="panel-head"><h3>สรุปสินค้าที่ซื้อ</h3><span class="hint">รวมตามสินค้า</span></div><div class="stack-list">
      ${summary.map(row => `
        <div class="list-item customer-summary-row">
          <div>
            <strong>${row.name}</strong>
            <small>จำนวนรวม ${money(row.qty)} • ${row.count} รายการ • ซื้อล่าสุด ${row.lastDate || "-"}</small>
          </div>
          <div><div class="money">${money(row.revenue)}</div><small class="${row.profit >= 0 ? "positive" : "negative"}">กำไร ${money(row.profit)}</small></div>
        </div>`).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">📊</div><strong>ยังไม่มีสรุปสินค้า</strong></div></div>`}
    </div></div>`;
  }

  // overview
  return `${summaryHtml}
    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-head"><h3>บิลล่าสุดของลูกค้านี้</h3><button class="link-btn" onclick="setCustomerHistoryView('bills')">ดูทั้งหมด</button></div>
        <div class="stack-list">
          ${stats.bills.slice(0, 5).map(b => `
            <div class="list-item customer-purchase-row ${b.status === "cancelled" ? "cancelled" : (Number(b.creditAmount || 0) > 0 ? "credit" : "")}">
              <div><strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)} ${Number(b.returnTotal || 0) > 0 ? `<span class="return-chip">มีคืนสินค้า</span>` : ""}</strong><small>${b.date} • ${billItems(b.id).length} รายการ • ${billItemText(b.id)}</small></div>
              <div class="money">${money(b.subtotal)}</div>
            </div>`).join("") || `<div class="list-item"><div><strong>ไม่พบบิล</strong></div></div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>สินค้าที่ซื้อบ่อย/มูลค่าสูง</h3><button class="link-btn" onclick="setCustomerHistoryView('summary')">ดูสรุปสินค้า</button></div>
        <div class="stack-list">
          ${summary.slice(0, 5).map(row => `<div class="list-item customer-summary-row"><div><strong>${row.name}</strong><small>จำนวน ${money(row.qty)} • ${row.count} รายการ</small></div><div class="money">${money(row.revenue)}</div></div>`).join("") || `<div class="list-item"><div><strong>ยังไม่มีสินค้า</strong></div></div>`}
        </div>
      </div>
    </div>`;
}

function renderCustomerDetail() {
  const wrap = $("customerDetailContent");
  if (!wrap) return;

  const c = state.customers.find(x => x.id === selectedCustomerDetailId);
  if (!c) {
    wrap.innerHTML = `<div class="panel"><div class="list-item"><div><strong>ยังไม่ได้เลือกลูกค้า</strong><small>ไปที่หน้าลูกค้า แล้วกดปุ่ม “รายละเอียด” หรือ “สมุดบัญชี”</small></div></div></div>`;
    return;
  }

  const allBills = customerBills(c.id).filter(b => b.status !== "cancelled");
  const payments = customerPayments(c.id);
  const totalSales = allBills.reduce((sum, b) => sum + Number(b.subtotal || 0), 0);
  const totalProfit = allBills.reduce((sum, b) => sum + Number(b.profitTotal || 0), 0);
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
        <div><span>จำนวนบิลทั้งหมด</span><strong>${allBills.length.toLocaleString("th-TH")}</strong></div>
        <div><span>วงเงินเครดิต</span><strong>${money(c.creditLimit || 0)}</strong></div>
        <div><span>เครดิตกี่วัน</span><strong>${Number(c.creditDays || 0).toLocaleString("th-TH")}</strong></div>
        <div><span>บิลเครดิตค้าง</span><strong>${allBills.filter(b => Number(b.creditAmount || 0) > 0).length.toLocaleString("th-TH")}</strong></div>
      </div>
    </div>

    ${renderCustomerHistoryContent(c)}

    <div class="panel">
      <div class="panel-head">
        <h3>ประวัติรับเงิน</h3>
        <span class="hint">รายการรับเงินที่ผูกกับลูกค้านี้</span>
      </div>
      <div class="stack-list">
        ${payments.slice(0, 12).map(p => {
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


window.setCustomerHistoryView = (view) => {
  if ($("customerHistoryView")) $("customerHistoryView").value = view;
  renderCustomerDetail();
};

function setCustomerHistoryRange(kind) {
  const now = new Date();
  if (kind === "today") {
    $("customerHistoryFrom").value = today();
    $("customerHistoryTo").value = today();
  } else if (kind === "7days") {
    $("customerHistoryFrom").value = addDays(now, -6);
    $("customerHistoryTo").value = today();
  } else if (kind === "month") {
    const r = monthRange(now);
    $("customerHistoryFrom").value = r.start;
    $("customerHistoryTo").value = r.end;
  } else if (kind === "prevMonth") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const r = monthRange(d);
    $("customerHistoryFrom").value = r.start;
    $("customerHistoryTo").value = r.end;
  }
  renderCustomerDetail();
}

function clearCustomerHistoryFilters() {
  ["customerHistoryFrom", "customerHistoryTo", "customerHistoryItemSearch"].forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("customerHistoryView")) $("customerHistoryView").value = "overview";
  if ($("customerHistoryIncludeCancelled")) $("customerHistoryIncludeCancelled").checked = false;
  renderCustomerDetail();
}

function customerHistoryText() {
  const c = state.customers.find(x => x.id === selectedCustomerDetailId);
  if (!c) return "";
  const stats = customerHistoryStats(c.id);
  const summary = customerProductSummary(c.id);
  const lines = [
    `สรุปการซื้อของลูกค้า: ${c.name}`,
    `ช่วงวันที่: ${customerHistoryRangeText()}`,
    "------------------------------",
    `จำนวนบิล: ${stats.billCount}`,
    `จำนวนรายการ: ${stats.itemCount}`,
    `ยอดซื้อรวม: ${money(stats.sales)} บาท`,
    `กำไรรวม: ${money(stats.profit)} บาท`,
    `ยอดค้าง: ${money(customerDebt(c.id))} บาท`,
    "------------------------------",
    "สินค้าที่ซื้อ:"
  ];
  summary.forEach((row, idx) => lines.push(`${idx + 1}. ${row.name} ${money(row.qty)} = ${money(row.revenue)} บาท`));
  return lines.join("\n");
}

async function copyCustomerHistory() {
  const text = customerHistoryText();
  if (!text) return alert("กรุณาเลือกลูกค้า");
  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกสรุปลูกค้าแล้ว");
  } catch {
    prompt("คัดลอกสรุปลูกค้า:", text);
  }
}

function printCustomerHistory() {
  const c = state.customers.find(x => x.id === selectedCustomerDetailId);
  if (!c) return alert("กรุณาเลือกลูกค้า");
  const stats = customerHistoryStats(c.id);
  const summary = customerProductSummary(c.id);
  $("printArea").innerHTML = `
    <div class="print-close">
      <h1>ประวัติการซื้อ: ${c.name}</h1>
      <div class="muted">ช่วงวันที่ ${customerHistoryRangeText()}</div>
      <div class="line"><span>จำนวนบิล</span><strong>${stats.billCount}</strong></div>
      <div class="line"><span>จำนวนรายการ</span><strong>${stats.itemCount}</strong></div>
      <div class="line"><span>ยอดซื้อรวม</span><strong>${money(stats.sales)}</strong></div>
      <div class="line total"><span>กำไรรวม</span><strong>${money(stats.profit)}</strong></div>
      <h3>สรุปสินค้า</h3>
      ${summary.map(row => `<div class="line"><span>${row.name} (${money(row.qty)})</span><strong>${money(row.revenue)}</strong></div>`).join("") || `<div class="muted">ไม่มีข้อมูลสินค้า</div>`}
    </div>
  `;
  window.print();
}

function exportCustomerHistoryCsv() {
  const c = state.customers.find(x => x.id === selectedCustomerDetailId);
  if (!c) return alert("กรุณาเลือกลูกค้า");
  const rows = [["customer", "date", "billNo", "product", "qty", "unitPrice", "discount", "revenue", "cost", "profit", "status"]];
  customerHistoryItems(c.id).forEach(item => rows.push([
    c.name,
    item.bill.date,
    item.bill.billNo,
    item.productNameSnapshot || productById(item.productId)?.name || "-",
    item.qty,
    item.unitPrice,
    item.discount || 0,
    item.revenue,
    item.cost,
    item.profit,
    item.bill.status
  ]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`khaikhong-customer-history-${c.name}-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

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
      <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)} ${Number(b.returnTotal || 0) > 0 ? `<span class="return-chip">มีคืนสินค้า</span>` : ""}</strong>
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
  if (!assertDateUnlocked(m.date, "ลบรายการซื้อเข้า")) return;

  if (!confirm(`ลบรายการซื้อเข้า?\n\nสินค้า: ${productById(m.productId)?.name || "-"}\nวันที่: ${m.date}\nจำนวน: ${money(m.qtyIn)}\n\nระบบจะคำนวณสต็อกและ FIFO ใหม่`)) return;

  await del("stock_movements", id);
  await rebuildCostSnapshots();
  await loadState();
  await logActivity("PURCHASE_DELETE", "ลบรายการซื้อเข้า", { refType: "stock_movement", refId: id, amount: Number(m.qtyIn || 0) * Number(m.unitCost || 0), detail: productById(m.productId)?.name || "-" });
  showToast("ลบรายการซื้อเข้าและคำนวณ FIFO ใหม่แล้ว");
};




function renderClosePeriod() {
  if (!$("closePeriodHistory")) return;

  if ($("closeLockUntil") && !$("closeLockUntil").value) $("closeLockUntil").value = today();

  const lock = currentLockPeriod();
  const lockDate = currentLockDate();

  if ($("currentLockText")) $("currentLockText").textContent = lock ? `ล็อกข้อมูลถึงวันที่ ${lockDate} (${lock.closeNo || "รอบปิด"})` : "ยังไม่มีการล็อกข้อมูลย้อนหลัง";
  if ($("currentLockBadge")) {
    $("currentLockBadge").textContent = lock ? `ล็อกถึง ${lockDate}` : "ยังไม่ล็อก";
    $("currentLockBadge").classList.toggle("locked", !!lock);
  }
  if ($("currentLockAdvice")) {
    $("currentLockAdvice").classList.toggle("locked", !!lock);
    $("currentLockAdvice").textContent = lock
      ? `ระบบจะไม่อนุญาตให้เพิ่ม/แก้/ลบ/ยกเลิก/คืนสินค้าในวันที่ ${lockDate} หรือก่อนหน้านั้น หากต้องแก้ไขต้องปลดล็อกก่อน`
      : "ยังไม่มีการปิดรอบ สามารถทำรายการย้อนหลังได้ตามปกติ แต่ก่อนส่งร้านทดลองควรใช้ปิดรอบหลังตรวจยอดทุกวัน";
  }

  const lockUntil = $("closeLockUntil")?.value || today();
  const s = closePeriodStats(lockUntil);
  if ($("closePeriodSummary")) {
    $("closePeriodSummary").innerHTML = `
      <div><span>จำนวนบิล</span><strong>${s.billCount.toLocaleString("th-TH")}</strong></div>
      <div><span>ยอดขาย</span><strong>${money(s.sales)}</strong></div>
      <div><span>ต้นทุน</span><strong>${money(s.cost)}</strong></div>
      <div><span>กำไร</span><strong>${money(s.profit)}</strong></div>
      <div><span>ยอดค้าง</span><strong>${money(s.credit)}</strong></div>
      <div><span>รับเงินลูกหนี้</span><strong>${money(s.payments)}</strong></div>
      <div><span>ซื้อเข้า</span><strong>${money(s.purchaseValue)}</strong></div>
      <div><span>คืนสินค้า</span><strong>${money(s.returnTotal)}</strong></div>
    `;
  }

  const rows = state.close_periods || [];
  $("closePeriodHistory").innerHTML = rows.map(p => `
    <div class="list-item close-period-row ${p.status === "reopened" ? "reopened" : ""}">
      <div>
        <strong>${p.closeNo || "CLOSE"} • ${closePeriodTypeName(p.type)}</strong>
        <small>ล็อกถึง ${p.lockUntil} • ${p.note || "-"} • สร้างเมื่อ ${p.createdAt ? new Date(p.createdAt).toLocaleString("th-TH") : "-"}</small>
        <small>บิล ${p.billCount || 0} • ยอดขาย ${money(p.sales || 0)} • กำไร ${money(p.profit || 0)} • ยอดค้าง ${money(p.credit || 0)}</small>
        ${p.status === "reopened" ? `<small class="locked-warning">ปลดล็อกแล้ว: ${p.reopenReason || "-"}</small>` : ""}
      </div>
      <div class="row-actions">
        <span class="close-period-badge ${p.status === "reopened" ? "" : "locked"}">${p.status === "reopened" ? "ปลดล็อกแล้ว" : "ล็อกอยู่"}</span>
        ${p.status !== "reopened" ? `<button class="small-btn small-danger" onclick="reopenClosePeriod('${p.id}')">ปลดล็อก</button>` : ""}
      </div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติการปิดรอบ</strong><small>เมื่อบันทึกปิดรอบ รายการจะแสดงที่นี่</small></div></div>`;
}

async function createClosePeriod() {
  const lockUntil = $("closeLockUntil")?.value || today();
  const type = $("closePeriodType")?.value || "daily";
  const note = $("closePeriodNote")?.value.trim() || closePeriodTypeName(type);

  if (!lockUntil) return alert("กรุณาเลือกวันที่ปิดรอบ");

  const current = currentLockDate();
  if (current && lockUntil <= current) {
    return alert(`ไม่สามารถปิดรอบซ้ำหรือย้อนกลับได้\n\nตอนนี้ล็อกถึง ${current} แล้ว\nถ้าต้องการเปลี่ยน ให้ปลดล็อกก่อน`);
  }

  const s = closePeriodStats(lockUntil);
  if (!confirm(`ยืนยันปิดรอบถึงวันที่ ${lockUntil}?\n\nหลังปิดรอบ ระบบจะไม่ให้แก้/ลบ/ยกเลิก/คืนสินค้าในวันที่นี้หรือก่อนหน้านั้น\n\nยอดขาย: ${money(s.sales)}\nกำไร: ${money(s.profit)}\nยอดค้าง: ${money(s.credit)}\n\nแนะนำให้ Backup ก่อนปิดรอบ`)) return;

  const closeNo = `CP-${lockUntil.replaceAll("-", "")}-${String((state.close_periods || []).length + 1).padStart(4, "0")}`;
  const now = new Date().toISOString();

  await put("close_periods", {
    id: uid(),
    closeNo,
    type,
    lockUntil,
    note,
    status: "closed",
    billCount: s.billCount,
    sales: s.sales,
    cost: s.cost,
    profit: s.profit,
    credit: s.credit,
    payments: s.payments,
    purchaseValue: s.purchaseValue,
    returnTotal: s.returnTotal,
    createdAt: now,
    updatedAt: now
  });

  if ($("closePeriodNote")) $("closePeriodNote").value = "";
  await loadState();
  switchTab("closePeriod");
  renderClosePeriod();
  await logActivity("CLOSE_PERIOD", `ปิดรอบ ${closeNo}`, { refType: "close_period", refNo: closeNo, amount: s.sales, detail: `ล็อกถึง ${lockUntil} • ${note}` });
  showToast(`ปิดรอบ ${closeNo} แล้ว`);
}

window.reopenClosePeriod = async (id) => {
  const p = state.close_periods.find(x => x.id === id);
  if (!p) return alert("ไม่พบรายการปิดรอบ");
  if (p.status === "reopened") return alert("รายการนี้ปลดล็อกแล้ว");

  const typed = prompt(`ปลดล็อกการปิดรอบ?\n\nรอบ: ${p.closeNo}\nล็อกถึง: ${p.lockUntil}\n\nพิมพ์เลขรอบเพื่อยืนยัน:`);
  if (typed !== p.closeNo) {
    if (typed !== null) alert("เลขรอบไม่ตรง ยกเลิกการปลดล็อก");
    return;
  }

  const reason = prompt("เหตุผลการปลดล็อก\n\nตัวอย่าง: แก้ข้อมูลย้อนหลัง / ตรวจพบรายการผิด", "");
  if (reason === null) return;
  const cleanReason = reason.trim();
  if (!cleanReason) return alert("กรุณาใส่เหตุผลการปลดล็อก");

  if (!confirm(`ยืนยันปลดล็อก ${p.closeNo}?`)) return;

  await put("close_periods", {
    ...p,
    status: "reopened",
    reopenReason: cleanReason,
    reopenedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await loadState();
  switchTab("closePeriod");
  renderClosePeriod();
  await logActivity("REOPEN_PERIOD", `ปลดล็อก ${p.closeNo}`, { refType: "close_period", refId: id, refNo: p.closeNo, detail: cleanReason });
  showToast(`ปลดล็อก ${p.closeNo} แล้ว`);
};

function setClosePeriodToday() {
  if ($("closeLockUntil")) $("closeLockUntil").value = today();
  if ($("closePeriodType")) $("closePeriodType").value = "daily";
  renderClosePeriod();
}

function setClosePeriodMonth() {
  if ($("closeLockUntil")) $("closeLockUntil").value = periodEndOfMonth(today());
  if ($("closePeriodType")) $("closePeriodType").value = "monthly";
  renderClosePeriod();
}

function stockCountDomId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stockCountDraftValue(productId) {
  const v = stockCountDraft[productId]?.countedQty;
  return v === undefined || v === null ? "" : v;
}

function parseStockCountValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stockCountRowsForView() {
  const q = ($("stockCountSearch")?.value || "").toLowerCase().trim();
  const category = $("stockCountCategoryFilter")?.value || "";
  const onlyDiff = !!$("stockCountOnlyDiff")?.checked;

  return activeProducts()
    .filter(p => !category || (p.category || "") === category)
    .filter(p => !q || `${p.name || ""} ${p.category || ""} ${p.unit || ""} ${p.note || ""}`.toLowerCase().includes(q))
    .filter(p => {
      if (!onlyDiff) return true;
      const counted = parseStockCountValue(stockCountDraftValue(p.id));
      if (counted === null) return false;
      return Math.abs(counted - Number(p.stockQty || 0)) > 0.000001;
    });
}

function stockCountDraftRows() {
  return Object.keys(stockCountDraft)
    .map(productId => {
      const p = productById(productId);
      if (!p) return null;
      const countedQty = parseStockCountValue(stockCountDraft[productId]?.countedQty);
      if (countedQty === null) return null;
      const systemQty = Number(p.stockQty || 0);
      const diffQty = countedQty - systemQty;
      const unitCost = Number(p.avgCost || 0);
      return {
        productId,
        productNameSnapshot: p.name,
        categorySnapshot: p.category || "",
        unitSnapshot: p.unit || "",
        systemQty,
        countedQty,
        diffQty,
        unitCost,
        diffValue: diffQty * unitCost,
        note: stockCountDraft[productId]?.note || ""
      };
    })
    .filter(Boolean);
}

function stockCountDiffClass(diffQty) {
  if (diffQty > 0.000001) return "in";
  if (diffQty < -0.000001) return "out";
  return "ok";
}

function stockCountDiffLabel(diffQty, unit = "") {
  if (diffQty > 0.000001) return `+${money(diffQty)} ${unit}`;
  if (diffQty < -0.000001) return `-${money(Math.abs(diffQty))} ${unit}`;
  return `ตรง ${unit || ""}`.trim();
}

function renderStockCountSummary() {
  const el = $("stockCountSummary");
  if (!el) return;

  const rows = stockCountDraftRows();
  const changed = rows.filter(r => Math.abs(r.diffQty) > 0.000001);
  const inQty = changed.filter(r => r.diffQty > 0).reduce((s, r) => s + r.diffQty, 0);
  const outQty = changed.filter(r => r.diffQty < 0).reduce((s, r) => s + Math.abs(r.diffQty), 0);
  const value = changed.reduce((s, r) => s + r.diffValue, 0);

  el.innerHTML = `
    <div><span>กรอกแล้ว</span><strong>${rows.length.toLocaleString("th-TH")}</strong></div>
    <div><span>รายการต่าง</span><strong>${changed.length.toLocaleString("th-TH")}</strong></div>
    <div><span>ปรับเพิ่ม</span><strong>${money(inQty)}</strong></div>
    <div><span>ปรับลด</span><strong>${money(outQty)}</strong></div>
    <div><span>ผลต่างมูลค่า</span><strong>${money(value)}</strong></div>
  `;
}

function updateStockCountLine(productId) {
  const p = productById(productId);
  if (!p) return;

  const counted = parseStockCountValue(stockCountDraftValue(productId));
  const safe = stockCountDomId(productId);
  const row = $("stockCountRow-" + safe);
  const diffEl = $("stockCountDiff-" + safe);
  const valueEl = $("stockCountValue-" + safe);

  row?.classList.remove("count-ok", "count-in", "count-out");

  if (counted === null) {
    if (diffEl) {
      diffEl.className = "stock-diff-chip";
      diffEl.textContent = "ยังไม่กรอก";
    }
    if (valueEl) valueEl.textContent = "มูลค่าผลต่าง 0.00";
    renderStockCountSummary();
    return;
  }

  const diff = counted - Number(p.stockQty || 0);
  const cls = stockCountDiffClass(diff);
  row?.classList.add(cls === "in" ? "count-in" : cls === "out" ? "count-out" : "count-ok");

  if (diffEl) {
    diffEl.className = `stock-diff-chip ${cls}`;
    diffEl.textContent = stockCountDiffLabel(diff, p.unit || "");
  }
  if (valueEl) valueEl.textContent = `มูลค่าผลต่าง ${money(diff * Number(p.avgCost || 0))}`;

  renderStockCountSummary();
}

window.updateStockCountDraft = (productId, field, value) => {
  const draft = stockCountDraft[productId] || {};
  draft[field] = value;
  stockCountDraft[productId] = draft;
  updateStockCountLine(productId);
};

function renderStockCountRows() {
  const list = $("stockCountRows");
  if (!list) return;

  const rows = stockCountRowsForView();
  if ($("stockCountRowsText")) $("stockCountRowsText").textContent = `แสดง ${rows.length.toLocaleString("th-TH")} รายการ`;

  list.innerHTML = rows.map(p => {
    const safe = stockCountDomId(p.id);
    const counted = stockCountDraftValue(p.id);
    const diff = parseStockCountValue(counted) === null ? null : Number(counted) - Number(p.stockQty || 0);
    const cls = diff === null ? "" : (stockCountDiffClass(diff) === "in" ? "count-in" : stockCountDiffClass(diff) === "out" ? "count-out" : "count-ok");
    const note = stockCountDraft[p.id]?.note || "";
    return `
      <div id="stockCountRow-${safe}" class="list-item stock-count-row ${cls}">
        <div class="stock-count-row-grid">
          <div>
            <strong>${p.name}</strong>
            <small>${productCategoryLabel(p)} • หน่วย ${p.unit || "-"} • ทุน FIFO ${money(p.avgCost || 0)}</small>
          </div>
          <div>
            <small>ยอดในระบบ</small>
            <div class="money">${money(p.stockQty)} ${p.unit || ""}</div>
          </div>
          <label>นับจริง
            <input class="stock-count-input" data-keypad="true" type="number" min="0" step="0.01" value="${counted}" oninput="updateStockCountDraft('${p.id}', 'countedQty', this.value)">
          </label>
          <div>
            <span id="stockCountDiff-${safe}" class="stock-diff-chip ${diff === null ? "" : stockCountDiffClass(diff)}">${diff === null ? "ยังไม่กรอก" : stockCountDiffLabel(diff, p.unit || "")}</span>
            <small id="stockCountValue-${safe}">มูลค่าผลต่าง ${money(diff === null ? 0 : diff * Number(p.avgCost || 0))}</small>
            <input class="stock-count-note" placeholder="หมายเหตุรายการนี้" value="${note}" oninput="updateStockCountDraft('${p.id}', 'note', this.value)">
          </div>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">📋</div><strong>ไม่พบสินค้า</strong><small>ลองล้างตัวกรองหรือเพิ่มสินค้าในระบบก่อน</small></div></div>`;

  renderStockCountSummary();
}

function renderStockCountHistory() {
  const list = $("stockCountHistory");
  const detail = $("stockCountDetail");
  if (!list) return;

  const rows = (state.stock_counts || []).slice(0, 20);
  list.innerHTML = rows.map(c => `
    <div class="list-item stock-count-history-row">
      <div>
        <strong>${c.countNo || "STOCK-COUNT"} ${c.status === "deleted" ? "• ลบแล้ว" : ""}</strong>
        <small>${c.date || "-"} • ${c.countedItems || 0} รายการ • ต่าง ${c.changedItems || 0} รายการ • ${c.note || "-"}</small>
        <small>ปรับเพิ่ม ${money(c.diffInQty || 0)} • ปรับลด ${money(c.diffOutQty || 0)} • มูลค่าผลต่าง ${money(c.diffValue || 0)}</small>
      </div>
      <div class="row-actions">
        <button class="small-btn" onclick="openStockCountDetail('${c.id}')">ดูรายละเอียด</button>
        <button class="small-btn small-danger" onclick="deleteStockCount('${c.id}')">ลบ/ย้อนรายการ</button>
      </div>
    </div>
  `).join("") || `<div class="list-item"><div><strong>ยังไม่มีประวัติการตรวจนับ</strong><small>เมื่อบันทึกตรวจนับ รายการจะแสดงที่นี่</small></div></div>`;

  if (!detail) return;
  const selected = state.stock_counts.find(c => c.id === selectedStockCountId);
  if (!selected) {
    detail.innerHTML = "";
    return;
  }

  const items = state.stock_count_items.filter(i => i.stockCountId === selected.id);
  detail.innerHTML = `
    <div class="panel stock-count-filter">
      <div class="panel-head">
        <h3>รายละเอียด ${selected.countNo}</h3>
        <span class="hint">${selected.date} • ${selected.note || "-"}</span>
      </div>
      <div class="stack-list">
        ${items.map(i => `
          <div class="list-item ${i.diffQty > 0 ? "count-in" : i.diffQty < 0 ? "count-out" : "count-ok"}">
            <div>
              <strong>${i.productNameSnapshot || productById(i.productId)?.name || "-"}</strong>
              <small>${i.categorySnapshot || "-"} • ยอดระบบ ${money(i.systemQty)} ${i.unitSnapshot || ""} • นับจริง ${money(i.countedQty)} ${i.unitSnapshot || ""}</small>
              ${i.note ? `<small>หมายเหตุ: ${i.note}</small>` : ""}
            </div>
            <div>
              <span class="stock-diff-chip ${stockCountDiffClass(i.diffQty)}">${stockCountDiffLabel(i.diffQty, i.unitSnapshot || "")}</span>
              <small>มูลค่า ${money(i.diffValue || 0)}</small>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderStockCount() {
  if (!$("stockCountRows")) return;
  if ($("stockCountDate") && !$("stockCountDate").value) $("stockCountDate").value = today();
  renderStockCountRows();
  renderStockCountHistory();
}

window.fillStockCountWithSystem = () => {
  stockCountRowsForView().forEach(p => {
    stockCountDraft[p.id] = {
      ...(stockCountDraft[p.id] || {}),
      countedQty: String(Number(p.stockQty || 0))
    };
  });
  renderStockCount();
};

window.clearStockCountDraft = () => {
  if (!confirm("ล้างจำนวนที่กรอกในหน้าตรวจนับนี้?")) return;
  stockCountDraft = {};
  renderStockCount();
};

async function applyStockCount() {
  const rows = stockCountDraftRows();

  if (!rows.length) return alert("ยังไม่ได้กรอกจำนวนที่นับจริง");

  const invalid = rows.find(r => r.countedQty < 0);
  if (invalid) return alert(`จำนวนที่นับจริงห้ามติดลบ: ${invalid.productNameSnapshot}`);

  const changed = rows.filter(r => Math.abs(r.diffQty) > 0.000001);
  if (!changed.length && !confirm("ยอดที่นับจริงตรงกับระบบทั้งหมด ต้องการบันทึกผลตรวจนับไว้หรือไม่?")) return;

  const date = $("stockCountDate")?.value || today();
  if (!assertDateUnlocked(date, "บันทึกตรวจนับย้อนหลัง")) return;
  const note = $("stockCountNote")?.value.trim() || "ตรวจนับสต็อก";
  const countId = uid();
  const countNo = `SC-${date.replaceAll("-", "")}-${String((state.stock_counts || []).length + 1).padStart(4, "0")}`;
  const now = new Date().toISOString();

  const diffInQty = changed.filter(r => r.diffQty > 0).reduce((s, r) => s + r.diffQty, 0);
  const diffOutQty = changed.filter(r => r.diffQty < 0).reduce((s, r) => s + Math.abs(r.diffQty), 0);
  const diffValue = changed.reduce((s, r) => s + r.diffValue, 0);

  await put("stock_counts", {
    id: countId,
    countNo,
    date,
    note,
    countedItems: rows.length,
    changedItems: changed.length,
    diffInQty,
    diffOutQty,
    diffValue,
    status: "completed",
    createdAt: now
  });

  for (const row of rows) {
    await put("stock_count_items", {
      id: uid(),
      stockCountId: countId,
      countNo,
      date,
      ...row,
      createdAt: now
    });
  }

  for (const row of changed) {
    await put("stock_movements", {
      id: uid(),
      productId: row.productId,
      type: row.diffQty > 0 ? "adjust_in" : "adjust_out",
      refType: "stock_count",
      refId: countId,
      date,
      qtyIn: row.diffQty > 0 ? row.diffQty : 0,
      qtyOut: row.diffQty < 0 ? Math.abs(row.diffQty) : 0,
      unitCost: row.unitCost,
      note: `${countNo}: ${note}${row.note ? " • " + row.note : ""}`,
      createdAt: now
    });
  }

  await recomputeInventory();
  stockCountDraft = {};
  selectedStockCountId = countId;
  if ($("stockCountNote")) $("stockCountNote").value = "";
  await loadState();
  await logActivity("STOCK_COUNT", `ตรวจนับสต็อก ${countNo}`, { refType: "stock_count", refId: countId, refNo: countNo, amount: diffValue, detail: `นับ ${rows.length} รายการ • ต่าง ${changed.length} รายการ` });
  switchTab("stockCount");
  showToast(`บันทึกตรวจนับ ${countNo} แล้ว`);
}

window.openStockCountDetail = (id) => {
  selectedStockCountId = id;
  renderStockCountHistory();
};

window.deleteStockCount = async (id) => {
  const c = state.stock_counts.find(x => x.id === id);
  if (!c) return alert("ไม่พบรายการตรวจนับ");
  if (!assertDateUnlocked(c.date, "ลบ/ย้อนรายการตรวจนับ")) return;

  if (!confirm(`ลบ/ย้อนรายการตรวจนับ ${c.countNo}?\n\nระบบจะลบรายการปรับสต็อกที่เกิดจากการตรวจนับนี้ และคำนวณ FIFO ใหม่`)) return;

  for (const item of state.stock_count_items.filter(i => i.stockCountId === id)) await del("stock_count_items", item.id);
  for (const m of state.stock_movements.filter(m => m.refType === "stock_count" && m.refId === id)) await del("stock_movements", m.id);
  await del("stock_counts", id);

  if (selectedStockCountId === id) selectedStockCountId = "";
  await recomputeInventory();
  await loadState();
  await logActivity("STOCK_COUNT_DELETE", `ลบ/ย้อนตรวจนับ ${c.countNo}`, { refType: "stock_count", refId: id, refNo: c.countNo, detail: "ลบ movement ที่เกี่ยวข้องและคำนวณ FIFO ใหม่" });
  showToast(`ลบ/ย้อนรายการตรวจนับ ${c.countNo} แล้ว`);
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
  if (!assertDateUnlocked(m.date, "ลบรายการปรับสต็อก")) return;

  const p = productById(m.productId);
  const qty = Number(m.qtyIn || 0) > 0 ? m.qtyIn : m.qtyOut;
  if (!confirm(`ลบรายการปรับสต็อก?\n\nสินค้า: ${p?.name || "-"}\nจำนวน: ${money(qty)}\nเหตุผล: ${m.note || "-"}\n\nระบบจะคำนวณสต็อกใหม่`)) return;

  await del("stock_movements", id);
  await rebuildCostSnapshots();
  await loadState();
  await logActivity("ADJUST_DELETE", "ลบรายการปรับสต็อก", { refType: "stock_movement", refId: id, detail: `${productById(m.productId)?.name || "-"} • ${m.type}` });
  showToast("ลบรายการปรับสต็อก/ทุนและคำนวณใหม่แล้ว");
};


function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function customerCreditDays(customerId) {
  const c = state.customers.find(x => x.id === customerId);
  return Math.max(0, Number(c?.creditDays || 0));
}

function billDueDate(b) {
  if (b.dueDate) return b.dueDate;
  return addDays(b.date || today(), customerCreditDays(b.customerId));
}

function debtStatusInfo(b) {
  const due = billDueDate(b);
  const diff = daysBetween(today(), due);
  if (diff < 0) return { key: "overdue", label: `เกินกำหนด ${Math.abs(diff)} วัน`, days: diff };
  if (diff === 0) return { key: "dueToday", label: "ครบกำหนดวันนี้", days: diff };
  if (diff <= 3) return { key: "dueSoon", label: `ใกล้ครบ ${diff} วัน`, days: diff };
  return { key: "notDue", label: `ยังไม่ครบ ${diff} วัน`, days: diff };
}

function debtAgingRows() {
  const q = ($("debtAgingSearch")?.value || "").toLowerCase().trim();
  const customerId = $("debtAgingCustomer")?.value || "";
  const status = $("debtAgingStatus")?.value || "";
  const from = $("debtDueFrom")?.value || "";
  const to = $("debtDueTo")?.value || "";

  return activeBills()
    .filter(b => (b.paymentType === "credit" || Number(b.creditAmount || 0) > 0) && Number(b.creditAmount || 0) > 0)
    .map(b => ({ ...b, dueDate: billDueDate(b), debtInfo: debtStatusInfo(b) }))
    .filter(b => !customerId || b.customerId === customerId)
    .filter(b => !status || b.debtInfo.key === status)
    .filter(b => !from || b.dueDate >= from)
    .filter(b => !to || b.dueDate <= to)
    .filter(b => {
      if (!q) return true;
      const hay = `${b.billNo || ""} ${customerName(b.customerId)} ${b.note || ""} ${b.dueDate || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => `${a.dueDate || ""} ${a.date || ""}`.localeCompare(`${b.dueDate || ""} ${b.date || ""}`));
}

function debtAgingStats(rows = debtAgingRows()) {
  return {
    count: rows.length,
    total: rows.reduce((s, b) => s + Number(b.creditAmount || 0), 0),
    overdueCount: rows.filter(b => b.debtInfo.key === "overdue").length,
    overdueTotal: rows.filter(b => b.debtInfo.key === "overdue").reduce((s, b) => s + Number(b.creditAmount || 0), 0),
    dueSoonCount: rows.filter(b => b.debtInfo.key === "dueToday" || b.debtInfo.key === "dueSoon").length,
    dueSoonTotal: rows.filter(b => b.debtInfo.key === "dueToday" || b.debtInfo.key === "dueSoon").reduce((s, b) => s + Number(b.creditAmount || 0), 0)
  };
}

function renderDebtAging() {
  const list = $("debtAgingResults");
  if (!list) return;

  const rows = debtAgingRows();
  const s = debtAgingStats(rows);

  $("debtAgingSummary").innerHTML = `
    <div><span>บิลค้าง</span><strong>${s.count.toLocaleString("th-TH")}</strong></div>
    <div><span>ยอดค้างรวม</span><strong>${money(s.total)}</strong></div>
    <div><span>เกินกำหนด</span><strong>${s.overdueCount.toLocaleString("th-TH")}</strong></div>
    <div><span>ยอดเกินกำหนด</span><strong>${money(s.overdueTotal)}</strong></div>
    <div><span>ใกล้ครบ/วันนี้</span><strong>${money(s.dueSoonTotal)}</strong></div>
  `;

  $("debtAgingResultText").textContent = rows.length ? `พบ ${rows.length} บิลเครดิตค้าง` : "ไม่พบบิลเครดิตค้างตามเงื่อนไข";

  list.innerHTML = rows.map(b => {
    const c = state.customers.find(x => x.id === b.customerId);
    return `
      <div class="list-item debt-aging-row ${b.debtInfo.key}">
        <div>
          <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)} <span class="debt-status-chip ${b.debtInfo.key}">${b.debtInfo.label}</span></strong>
          <div class="debt-meta">
            <span>ลูกค้า: ${customerName(b.customerId)}</span>
            <span>วันที่บิล: ${b.date}</span>
            <span>ครบกำหนด: ${b.dueDate}</span>
            <span>เครดิต ${customerCreditDays(b.customerId)} วัน</span>
          </div>
          <small>${billItemText(b.id) || "ไม่มีรายการสินค้า"} ${c?.phone ? "• โทร " + c.phone : ""}</small>
        </div>
        <div class="row-actions">
          <div>
            <div class="money negative">${money(b.creditAmount)}</div>
            <small>ยอดบิล ${money(b.subtotal)} • รับแล้ว ${money(b.paidAmount)}</small>
          </div>
          <button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>
          <button class="small-btn small-edit" onclick="openPaymentForDebtBill('${b.id}')">รับเงิน</button>
          <button class="small-btn" onclick="copyDebtMessage('${b.id}')">คัดลอกแจ้งยอด</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">✅</div><strong>ไม่พบลูกหนี้ตามเงื่อนไข</strong><small>ลองล้างตัวกรองหรือเลือกสถานะอื่น</small></div></div>`;
}

window.openPaymentForDebtBill = (billId) => {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return alert("ไม่พบบิล");
  $("paymentCustomer").value = b.customerId || "";
  renderPaymentBillOptions();
  if ($("paymentBill")) $("paymentBill").value = b.id;
  if ($("paymentAmount")) $("paymentAmount").value = Number(b.creditAmount || 0);
  renderOutstandingBills();
  switchTab("payments");
};

function debtMessageText(billId) {
  const b = state.bills.find(x => x.id === billId);
  if (!b) return "";
  const c = state.customers.find(x => x.id === b.customerId);
  const due = billDueDate(b);
  const info = debtStatusInfo(b);
  return [
    `สวัสดีครับ/ค่ะ คุณ${customerName(b.customerId)}`,
    `แจ้งยอดค้างชำระบิล ${b.billNo}`,
    `ยอดค้าง: ${money(b.creditAmount)} บาท`,
    `วันที่บิล: ${b.date}`,
    `วันครบกำหนด: ${due} (${info.label})`,
    "",
    "รบกวนชำระตามสะดวก หากชำระแล้วขออภัยด้วยครับ/ค่ะ",
    c?.phone ? `เบอร์ติดต่อ: ${c.phone}` : ""
  ].filter(Boolean).join("\n");
}

window.copyDebtMessage = async (billId) => {
  const text = debtMessageText(billId);
  if (!text) return alert("ไม่พบบิล");
  await copyTextToClipboard(text, "คัดลอกข้อความแจ้งยอดแล้ว");
};

function copyDebtSummary() {
  const rows = debtAgingRows();
  const s = debtAgingStats(rows);
  const lines = [
    "สรุปลูกหนี้ครบกำหนด",
    `วันที่: ${today()}`,
    `จำนวนบิลค้าง: ${s.count}`,
    `ยอดค้างรวม: ${money(s.total)} บาท`,
    `ยอดเกินกำหนด: ${money(s.overdueTotal)} บาท`,
    "",
    "รายการ:",
    ...rows.slice(0, 30).map((b, idx) => `${idx + 1}. ${customerName(b.customerId)} • ${b.billNo} • ค้าง ${money(b.creditAmount)} • ครบกำหนด ${b.dueDate} • ${b.debtInfo.label}`)
  ];
  copyTextToClipboard(lines.join("\n"), "คัดลอกสรุปลูกหนี้แล้ว");
}

function exportDebtAgingCsv() {
  const rows = [["billNo", "billDate", "dueDate", "customer", "creditDays", "creditAmount", "status", "subtotal", "paidAmount"]];
  debtAgingRows().forEach(b => rows.push([b.billNo, b.date, b.dueDate, customerName(b.customerId), customerCreditDays(b.customerId), b.creditAmount, b.debtInfo.label, b.subtotal, b.paidAmount]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`khaikhong-debt-aging-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

function clearDebtAgingFilters() {
  ["debtAgingSearch", "debtAgingCustomer", "debtAgingStatus", "debtDueFrom", "debtDueTo"].forEach(id => { if ($(id)) $(id).value = ""; });
  renderDebtAging();
}

function setDebtAgingStatus(status) {
  if ($("debtAgingStatus")) $("debtAgingStatus").value = status || "";
  renderDebtAging();
}


/* v2.3.18: Activity Log / Audit Trail */
const ACTIVITY_GROUPS = {
  SALE_CREATE: "sale",
  BILL_CANCEL: "sale",
  BILL_DELETE: "sale",
  ITEM_RETURN: "sale",
  PAYMENT_CREATE: "money",
  PAYMENT_UPDATE: "money",
  PAYMENT_DELETE: "money",
  PRODUCT_SAVE: "stock",
  PRODUCT_DELETE: "stock",
  PRODUCT_ARCHIVE: "stock",
  PURCHASE_SAVE: "stock",
  PURCHASE_DELETE: "stock",
  ADJUST_SAVE: "stock",
  ADJUST_DELETE: "stock",
  STOCK_COUNT: "stock",
  STOCK_COUNT_DELETE: "stock",
  FIFO_REPAIR: "stock",
  CUSTOMER_SAVE: "customer",
  CUSTOMER_DELETE: "customer",
  CLOSE_PERIOD: "system",
  REOPEN_PERIOD: "system",
  BACKUP_EXPORT: "system",
  BACKUP_IMPORT: "system",
  CLEAR_ALL: "system",
  USER_SAVE: "system",
  USER_DELETE: "system",
  USER_SWITCH: "system",
  USER_RESET: "system"
};

const ACTIVITY_LABELS = {
  SALE_CREATE: "ขายบิล",
  BILL_CANCEL: "ยกเลิกบิล",
  BILL_DELETE: "ลบบิลถาวร",
  ITEM_RETURN: "คืนสินค้า",
  PAYMENT_CREATE: "รับเงิน",
  PAYMENT_UPDATE: "แก้ไขรับเงิน",
  PAYMENT_DELETE: "ลบรับเงิน",
  PRODUCT_SAVE: "บันทึกสินค้า",
  PRODUCT_DELETE: "ลบสินค้า",
  PRODUCT_ARCHIVE: "ซ่อนสินค้า",
  PURCHASE_SAVE: "ซื้อเข้า",
  PURCHASE_DELETE: "ลบซื้อเข้า",
  ADJUST_SAVE: "ปรับสต็อก",
  ADJUST_DELETE: "ลบปรับสต็อก",
  STOCK_COUNT: "ตรวจนับสต็อก",
  STOCK_COUNT_DELETE: "ลบ/ย้อนตรวจนับ",
  FIFO_REPAIR: "ตรวจ/ซ่อม FIFO",
  CUSTOMER_SAVE: "บันทึกลูกค้า",
  CUSTOMER_DELETE: "ลบลูกค้า",
  CLOSE_PERIOD: "ปิดรอบ",
  REOPEN_PERIOD: "ปลดล็อกปิดรอบ",
  BACKUP_EXPORT: "Export Backup",
  BACKUP_IMPORT: "Restore Backup",
  CLEAR_ALL: "ล้างข้อมูลทั้งหมด",
  USER_SAVE: "บันทึกผู้ใช้",
  USER_DELETE: "ลบผู้ใช้",
  USER_SWITCH: "สลับผู้ใช้",
  USER_RESET: "รีเซ็ตผู้ใช้"
};

function activityGroup(action) {
  return ACTIVITY_GROUPS[action] || "system";
}

function activityLabel(action) {
  return ACTIVITY_LABELS[action] || action || "-";
}

function safeText(v) {
  return String(v ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}

function activityActor() {
  try {
    if (typeof activeUser === "function") {
      const u = activeUser();
      return {
        userId: u?.id || "unknown",
        userName: u?.name || "ไม่ระบุ",
        userRole: typeof roleName === "function" ? roleName(u?.role || "owner") : (u?.role || "owner")
      };
    }
  } catch {}
  return { userId: "owner", userName: "เจ้าของร้าน", userRole: "เจ้าของร้าน" };
}

async function logActivity(action, title, meta = {}) {
  try {
    if (!db || !STORES.includes("activity_logs")) return null;
    const actor = activityActor();
    const now = new Date();
    const log = {
      id: uid(),
      action,
      group: activityGroup(action),
      label: activityLabel(action),
      title: title || activityLabel(action),
      detail: meta.detail || "",
      refType: meta.refType || "",
      refId: meta.refId || "",
      refNo: meta.refNo || "",
      amount: Number(meta.amount || 0),
      userId: actor.userId,
      userName: actor.userName,
      userRole: actor.userRole,
      date: now.toISOString().slice(0, 10),
      time: now.toLocaleTimeString("th-TH"),
      createdAt: now.toISOString(),
      meta
    };

    await put("activity_logs", log);
    if (Array.isArray(state.activity_logs)) {
      state.activity_logs.unshift(log);
      state.activity_logs = state.activity_logs.slice(0, 1500);
    }
    return log;
  } catch (err) {
    console.error("logActivity failed", err);
    return null;
  }
}

function activityUsers() {
  return [...new Map((state.activity_logs || []).map(l => [l.userId || l.userName, l])).values()]
    .sort((a, b) => (a.userName || "").localeCompare(b.userName || "", "th"));
}

function renderActivityUserOptions() {
  const el = $("activityUserFilter");
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">ทุกผู้ใช้งาน</option>` + activityUsers().map(u => `<option value="${safeText(u.userId || u.userName)}">${safeText(u.userName || "-")} • ${safeText(u.userRole || "-")}</option>`).join("");
  if ([...el.options].some(o => o.value === cur)) el.value = cur;
}

function activityLogRows() {
  const q = ($("activitySearch")?.value || "").toLowerCase().trim();
  const user = $("activityUserFilter")?.value || "";
  const group = $("activityActionFilter")?.value || "";
  const from = $("activityFrom")?.value || "";
  const to = $("activityTo")?.value || "";

  return (state.activity_logs || [])
    .filter(l => !from || l.date >= from)
    .filter(l => !to || l.date <= to)
    .filter(l => !user || (l.userId || l.userName) === user)
    .filter(l => !group || l.group === group)
    .filter(l => {
      if (!q) return true;
      const hay = `${l.action || ""} ${l.label || ""} ${l.title || ""} ${l.detail || ""} ${l.refNo || ""} ${l.userName || ""} ${JSON.stringify(l.meta || {})}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => `${b.createdAt || ""}`.localeCompare(`${a.createdAt || ""}`));
}

function activityStats(rows = activityLogRows()) {
  return {
    total: rows.length,
    sale: rows.filter(r => r.group === "sale").length,
    money: rows.filter(r => r.group === "money").length,
    stock: rows.filter(r => r.group === "stock").length,
    system: rows.filter(r => r.group === "system").length
  };
}

function renderActivityLog() {
  const list = $("activityLogResults");
  if (!list) return;

  renderActivityUserOptions();
  const rows = activityLogRows();
  const s = activityStats(rows);

  $("activitySummary").innerHTML = `
    <div><span>ทั้งหมด</span><strong>${s.total.toLocaleString("th-TH")}</strong></div>
    <div><span>ขาย/บิล</span><strong>${s.sale.toLocaleString("th-TH")}</strong></div>
    <div><span>รับเงิน</span><strong>${s.money.toLocaleString("th-TH")}</strong></div>
    <div><span>สต็อก</span><strong>${s.stock.toLocaleString("th-TH")}</strong></div>
    <div><span>ระบบ</span><strong>${s.system.toLocaleString("th-TH")}</strong></div>
  `;

  $("activityResultText").textContent = rows.length ? `พบ ${rows.length} รายการ` : "ยังไม่มีประวัติตามเงื่อนไข";

  list.innerHTML = rows.slice(0, 300).map(l => `
    <div class="list-item activity-row ${safeText(l.group)}">
      <div>
        <strong>${safeText(l.title || l.label)} <span class="activity-chip">${safeText(l.label)}</span></strong>
        <div class="activity-meta">
          <span>${safeText(l.date)} ${safeText(l.time)}</span>
          <span>ผู้ใช้: ${safeText(l.userName || "-")}</span>
          <span>${safeText(l.userRole || "-")}</span>
          ${l.refNo ? `<span>อ้างอิง: ${safeText(l.refNo)}</span>` : ""}
          ${Number(l.amount || 0) ? `<span>ยอด: ${money(l.amount)}</span>` : ""}
        </div>
        ${l.detail ? `<small class="activity-detail">${safeText(l.detail)}</small>` : ""}
      </div>
      <div class="row-actions">
        ${l.refType === "bill" && l.refId ? `<button class="small-btn" onclick="openBillDetail('${safeText(l.refId)}')">ดูบิล</button>` : ""}
      </div>
    </div>
  `).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🧾</div><strong>ยังไม่มีประวัติ</strong><small>เมื่อมีการขาย รับเงิน หรือแก้ไขข้อมูล ระบบจะบันทึกที่นี่</small></div></div>`;
}

function setActivityRange(kind) {
  if (kind === "today") {
    $("activityFrom").value = today();
    $("activityTo").value = today();
  } else if (kind === "7days") {
    $("activityFrom").value = addDays(new Date(), -6);
    $("activityTo").value = today();
  }
  renderActivityLog();
}

function clearActivityFilters() {
  ["activitySearch", "activityUserFilter", "activityActionFilter", "activityFrom", "activityTo"].forEach(id => { if ($(id)) $(id).value = ""; });
  renderActivityLog();
}

function exportActivityLogCsv() {
  const rows = [["date","time","user","role","group","action","title","refNo","amount","detail"]];
  activityLogRows().forEach(l => rows.push([l.date, l.time, l.userName, l.userRole, l.group, l.label, l.title, l.refNo, l.amount || 0, l.detail || ""]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  download(`khaikhong-activity-log-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
  logActivity("BACKUP_EXPORT", "Export Activity Log", { detail: `Export ${rows.length - 1} รายการ`, amount: rows.length - 1 });
}

function copyActivitySummary() {
  const rows = activityLogRows();
  const s = activityStats(rows);
  const lines = [
    "สรุปประวัติการทำรายการ",
    `วันที่: ${today()}`,
    `ทั้งหมด: ${s.total}`,
    `ขาย/บิล: ${s.sale}`,
    `รับเงิน: ${s.money}`,
    `สต็อก: ${s.stock}`,
    `ระบบ: ${s.system}`,
    "",
    "ล่าสุด:",
    ...rows.slice(0, 20).map((l, i) => `${i + 1}. ${l.date} ${l.time} • ${l.userName} • ${l.label} • ${l.title}`)
  ];
  copyTextToClipboard(lines.join("\n"), "คัดลอกสรุปประวัติแล้ว");
}

async function clearTestActivityLogs() {
  const testRows = (state.activity_logs || []).filter(l => `${l.title || ""} ${l.detail || ""} ${l.refNo || ""}`.toUpperCase().includes("TEST"));
  if (!testRows.length) return alert("ไม่พบ Log TEST");
  if (!confirm(`ล้าง Log TEST ${testRows.length} รายการ?`)) return;
  for (const l of testRows) await del("activity_logs", l.id);
  await loadState();
  showToast("ล้าง Log TEST แล้ว");
}

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
  if (!assertDateUnlocked(p.date, "ลบรายการรับเงิน")) return;

  if (!confirm(`ลบรายการรับเงิน?\n\nลูกค้า: ${customerName(p.customerId)}\nวันที่: ${p.date}\nจำนวน: ${money(p.amount)} บาท\n\nยอดค้างจะถูกคำนวณใหม่`)) return;

  await del("payments", id);
  await recalcBills();
  await loadState();
  await logActivity("PAYMENT_DELETE", "ลบรายการรับเงิน", { refType: "payment", refId: id, amount: p.amount || 0, detail: `${customerName(p.customerId)} • ${p.method || "-"}` });
  showToast("ลบรายการรับเงินแล้ว");
};


async function deleteCancelledBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b) return alert("ไม่พบบิล");
  if (!assertDateUnlocked(b.date, "ลบถาวรบิลที่อยู่ในรอบปิดแล้ว")) return;
  if (b.status !== "cancelled") return alert("ลบถาวรได้เฉพาะบิลที่ยกเลิกแล้วเท่านั้น");

  const typed = prompt(`ลบบิลถาวร?\n\nบิล: ${b.billNo}\nการกระทำนี้จะลบบิล รายการสินค้าในบิล การเคลื่อนไหวสต็อก และรายการรับเงินที่ผูกกับบิลนี้\n\nพิมพ์เลขบิลเพื่อยืนยัน:`);
  if (typed !== b.billNo) {
    if (typed !== null) alert("เลขบิลไม่ตรง ยกเลิกการลบ");
    return;
  }

  if (!confirm(`ยืนยันลบถาวร ${b.billNo} อีกครั้ง?`)) return;

  const relatedReturns = state.returns.filter(r => r.billId === id);
  const relatedReturnIds = relatedReturns.map(r => r.id);

  for (const item of state.return_items.filter(i => i.billId === id || relatedReturnIds.includes(i.returnId))) await del("return_items", item.id);
  for (const r of relatedReturns) await del("returns", r.id);
  for (const item of state.bill_items.filter(i => i.billId === id)) await del("bill_items", item.id);
  for (const m of state.stock_movements.filter(m => m.refId === id || relatedReturnIds.includes(m.refId) || (m.note || "").includes(b.billNo))) await del("stock_movements", m.id);
  for (const p of state.payments.filter(p => p.billId === id)) await del("payments", p.id);
  await del("bills", id);

  selectedBillId = "";
  await rebuildCostSnapshots();
  await loadState();
  await logActivity("BILL_DELETE", `ลบบิลถาวร ${b.billNo}`, { refType: "bill", refId: id, refNo: b.billNo, amount: b.subtotal || 0, detail: "ลบบิลที่ยกเลิกแล้ว" });
  showToast(`ลบถาวร ${b.billNo} แล้ว`);
}
window.deleteCancelledBill = deleteCancelledBill;


function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 10);
  const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

function billItemText(billId) {
  return billItems(billId)
    .map(item => `${item.productNameSnapshot || productById(item.productId)?.name || "-"} x${money(item.qty)}`)
    .join(", ");
}

function billSearchRows() {
  const text = ($("billSearchText")?.value || "").toLowerCase().trim();
  const itemText = ($("billSearchItem")?.value || "").toLowerCase().trim();
  const from = $("billSearchFrom")?.value || "";
  const to = $("billSearchTo")?.value || "";
  const customerId = $("billSearchCustomer")?.value || "";
  const status = $("billSearchStatus")?.value || "";
  const paymentType = $("billSearchPaymentType")?.value || "";

  return state.bills.filter(b => {
    if (from && b.date < from) return false;
    if (to && b.date > to) return false;
    if (customerId && b.customerId !== customerId) return false;
    if (paymentType && b.paymentType !== paymentType) return false;

    if (status) {
      if (status === "creditDue") {
        if (!(Number(b.creditAmount || 0) > 0 && b.status !== "cancelled")) return false;
      } else if (b.status !== status) {
        return false;
      }
    }

    if (text) {
      const hay = `${b.billNo || ""} ${customerName(b.customerId)} ${b.note || ""} ${b.status || ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }

    if (itemText) {
      const itemHay = billItems(b.id)
        .map(item => `${item.productNameSnapshot || ""} ${productById(item.productId)?.name || ""}`)
        .join(" ")
        .toLowerCase();
      if (!itemHay.includes(itemText)) return false;
    }

    return true;
  }).sort((a, b) => `${b.date || ""} ${b.createdAt || ""}`.localeCompare(`${a.date || ""} ${a.createdAt || ""}`));
}

function billSearchClass(b) {
  if (b.status === "cancelled") return "cancelled";
  if (Number(b.creditAmount || 0) > 0 || b.paymentType === "credit") return "credit";
  return "";
}

function renderBillSearch() {
  if (!$("billSearchResults")) return;

  const rows = billSearchRows();
  const activeRows = rows.filter(b => b.status !== "cancelled");

  $("billSearchCount").textContent = rows.length.toLocaleString("th-TH");
  $("billSearchSales").textContent = money(activeRows.reduce((s, b) => s + Number(b.subtotal || 0), 0));
  $("billSearchCost").textContent = money(activeRows.reduce((s, b) => s + Number(b.costTotal || 0), 0));
  $("billSearchProfit").textContent = money(activeRows.reduce((s, b) => s + Number(b.profitTotal || 0), 0));
  $("billSearchCredit").textContent = money(activeRows.reduce((s, b) => s + Number(b.creditAmount || 0), 0));
  $("billSearchResultText").textContent = rows.length ? `พบ ${rows.length} บิล` : "ไม่พบบิลตามเงื่อนไข";

  $("billSearchResults").innerHTML = rows.map(b => {
    const items = billItems(b.id);
    const itemPreview = billItemText(b.id) || "ไม่มีรายการสินค้า";
    const actions = [
      `<button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button>`,
      `<button class="small-btn" onclick="copyBillText('${b.id}')">คัดลอก</button>`,
      `<button class="small-btn" onclick="printBill('${b.id}')">พิมพ์</button>`,
      b.status !== "cancelled"
        ? `<button class="small-btn small-danger" onclick="cancelBill('${b.id}')">ยกเลิก</button>`
        : `<button class="small-btn small-danger" onclick="deleteCancelledBill('${b.id}')">ลบถาวร</button>`
    ].join("");

    return `
      <div class="list-item bill-search-row ${billSearchClass(b)}">
        <div>
          <strong><button class="bill-link" onclick="openBillDetail('${b.id}')">${b.billNo}</button> ${billBadge(b)} ${Number(b.returnTotal || 0) > 0 ? `<span class="return-chip">มีคืนสินค้า</span>` : ""}</strong>
          <div class="bill-meta">
            <span>${b.date || "-"}</span>
            <span>${customerName(b.customerId)}</span>
            <span>${items.length} รายการ</span>
            <span>${b.paymentType === "credit" ? "เครดิต" : "เงินสด/โอน"}</span>
          </div>
          <small class="bill-items-preview">${itemPreview}</small>
          ${b.status === "cancelled" && b.cancelReason ? `<small class="negative">ยกเลิก: ${b.cancelReason}</small>` : ""}
        </div>
        <div class="row-actions">
          <div>
            <div class="money">${money(b.subtotal)}</div>
            <small class="${Number(b.profitTotal || 0) >= 0 ? "positive" : "negative"}">กำไร ${money(b.profitTotal)}</small>
            ${Number(b.creditAmount || 0) > 0 ? `<small class="negative">ค้าง ${money(b.creditAmount)}</small>` : ""}
          </div>
          ${actions}
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🔎</div><strong>ไม่พบบิล</strong><small>ลองเปลี่ยนช่วงวันที่ หรือค้นหาจากเลขบิล/ลูกค้า/สินค้า</small></div></div>`;
}

function setBillSearchRange(kind) {
  const now = new Date();
  if (kind === "today") {
    $("billSearchFrom").value = today();
    $("billSearchTo").value = today();
  } else if (kind === "yesterday") {
    const y = addDays(now, -1);
    $("billSearchFrom").value = y;
    $("billSearchTo").value = y;
  } else if (kind === "7days") {
    $("billSearchFrom").value = addDays(now, -6);
    $("billSearchTo").value = today();
  } else if (kind === "month") {
    const r = monthRange(now);
    $("billSearchFrom").value = r.start;
    $("billSearchTo").value = r.end;
  }
  renderBillSearch();
}

function clearBillSearch() {
  ["billSearchText", "billSearchItem", "billSearchFrom", "billSearchTo", "billSearchCustomer", "billSearchStatus", "billSearchPaymentType"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  renderBillSearch();
}

function exportBillSearchCsv() {
  const rows = [["billNo", "date", "customer", "items", "paymentType", "status", "grossTotal", "discountTotal", "returnTotal", "subtotal", "cost", "profit", "creditAmount"]];
  billSearchRows().forEach(b => {
    rows.push([
      b.billNo,
      b.date,
      customerName(b.customerId),
      billItemText(b.id),
      b.paymentType,
      b.status,
      b.grossTotal || b.subtotal,
      b.discountTotal || 0,
      b.returnTotal || 0,
      b.subtotal,
      b.costTotal,
      b.profitTotal,
      b.creditAmount || 0
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`khaikhong-bill-search-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

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
    <td><div class="row-actions"><button class="small-btn" onclick="openBillDetail('${b.id}')">ดูบิล</button><button class="small-btn" onclick="copyBillText('${b.id}')">คัดลอกเต็ม</button>${b.status !== "cancelled" ? `<button class="small-btn small-danger" onclick="cancelBill('${b.id}')">ยกเลิก</button>` : `<button class="small-btn small-danger" onclick="deleteCancelledBill('${b.id}')">ลบถาวร</button>`}</div></td>
  </tr>`).join("") || `<tr><td colspan="8">ไม่พบรายการขาย</td></tr>`;
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
      lines.push(`${p.name} | หมวดหมู่ ${productCategoryLabel(p)} | เหลือ ${money(p.stockQty)} ${p.unit || ""} | ขั้นต่ำ ${money(p.minStock)} | ปลีก ${money(p.price)} / ส่ง ${money(productWholesalePrice(p))}`);
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
    lines.push(`${item.productNameSnapshot || productById(item.productId)?.name || "-"} x ${money(item.qty)} = ${money(item.revenue)} บาท${Number(item.discount || 0) > 0 ? ` (ลด ${money(item.discount)})` : ""}`);
  });

  lines.push("--------------------------------");
  if (Number(b.discountTotal || 0) > 0) lines.push(`ส่วนลดรวม: ${money(b.discountTotal)} บาท`);
  if (Number(b.returnTotal || 0) > 0) lines.push(`คืนสินค้า: ${money(b.returnTotal)} บาท`);
  lines.push(`ยอดรวมสุทธิ: ${money(b.subtotal)} บาท`);
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
              <small>จำนวน ${money(item.qty)} × ${money(item.unitPrice)}${Number(item.discount || 0) > 0 ? ` • ลด ${money(item.discount)}` : ""}</small>
            </div>
            <div class="money">${money(item.revenue)}</div>
          </div>
        `).join("")}
      </div>

      <div class="receipt-total">
        <div><span>ลูกค้า</span><span>${customerName(b.customerId)}</span></div>
        <div><span>รับเงินแล้ว</span><span class="paid-amount">${money(b.paidAmount)}</span></div>
        ${Number(b.discountTotal || 0) > 0 ? `<div><span>ส่วนลดรวม</span><span class="credit-due">${money(b.discountTotal)}</span></div>` : ""}
        ${Number(b.returnTotal || 0) > 0 ? `<div><span>คืนสินค้า</span><span class="credit-due">${money(b.returnTotal)}</span></div>` : ""}
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
          ${Number(b.discountTotal || 0) > 0 ? `<tr><td colspan="2">ส่วนลดรวม</td><td class="right">${money(b.discountTotal)}</td></tr>` : ""}
          ${Number(b.returnTotal || 0) > 0 ? `<tr><td colspan="2">คืนสินค้า</td><td class="right">${money(b.returnTotal)}</td></tr>` : ""}
          <tr><td colspan="2" class="total">ยอดรวมสุทธิ</td><td class="right total">${money(b.subtotal)}</td></tr>
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


async function returnBillItem(billItemId) {
  const item = state.bill_items.find(x => x.id === billItemId);
  if (!item) return alert("ไม่พบรายการสินค้าในบิล");

  const b = state.bills.find(x => x.id === item.billId);
  if (!b) return alert("ไม่พบบิล");
  if (!assertDateUnlocked(b.date, "รับคืนสินค้าจากบิลที่ปิดรอบแล้ว")) return;
  if (b.status === "cancelled") return alert("บิลนี้ถูกยกเลิกแล้ว ไม่สามารถรับคืนเพิ่มได้");

  const remain = remainingReturnQty(item);
  if (remain <= 0) return alert("รายการนี้คืนครบแล้ว");

  const productName = item.productNameSnapshot || productById(item.productId)?.name || "-";
  const qtyText = prompt(`รับคืนสินค้า: ${productName}\n\nซื้อไป ${money(item.qty)}\nคืนไปแล้ว ${money(returnedQtyForItem(item.id))}\nคงเหลือที่คืนได้ ${money(remain)}\n\nกรุณาใส่จำนวนที่รับคืน`, String(remain));
  if (qtyText === null) return;

  const qty = Number(qtyText);
  if (!qty || qty <= 0) return alert("กรุณาใส่จำนวนที่ถูกต้อง");
  if (qty > remain) return alert(`คืนได้ไม่เกิน ${money(remain)}`);

  const reason = prompt("เหตุผลการคืนสินค้า\n\nตัวอย่าง: ลูกค้าคืนของ / สินค้าเสีย / เปลี่ยนสินค้า / กรอกผิด", "");
  if (reason === null) return;
  const cleanReason = reason.trim();
  if (!cleanReason) return alert("กรุณาใส่เหตุผลการคืนสินค้า");

  const unitRevenue = itemReturnUnitRevenue(item);
  const unitCost = itemReturnUnitCost(item);
  const returnRevenue = qty * unitRevenue;
  const returnCost = qty * unitCost;

  if (!confirm(`ยืนยันรับคืนสินค้า?\n\nบิล: ${b.billNo}\nสินค้า: ${productName}\nจำนวนคืน: ${money(qty)}\nยอดคืน: ${money(returnRevenue)} บาท\n\nระบบจะคืนสต็อกและปรับยอดขาย/กำไรของบิล`)) return;

  const now = new Date().toISOString();
  const returnId = uid();

  await put("returns", {
    id: returnId,
    billId: b.id,
    billNo: b.billNo,
    customerId: b.customerId || "",
    date: today(),
    reason: cleanReason,
    totalRevenue: returnRevenue,
    totalCost: returnCost,
    status: "completed",
    createdAt: now
  });

  await put("return_items", {
    id: uid(),
    returnId,
    billId: b.id,
    billItemId: item.id,
    productId: item.productId,
    productNameSnapshot: productName,
    qty,
    unitPrice: item.unitPrice,
    unitRevenue,
    unitCost,
    revenue: returnRevenue,
    cost: returnCost,
    reason: cleanReason,
    date: today(),
    createdAt: now
  });

  await put("stock_movements", {
    id: uid(),
    productId: item.productId,
    type: "sale_return",
    refType: "return",
    refId: returnId,
    billId: b.id,
    date: today(),
    qtyIn: qty,
    qtyOut: 0,
    unitCost,
    note: `รับคืนจากบิล ${b.billNo}: ${cleanReason}`,
    createdAt: now
  });

  await recomputeInventory();
  selectedBillId = b.id;
  await loadState();
  await logActivity("ITEM_RETURN", `คืนสินค้า ${productName}`, { refType: "bill", refId: b.id, refNo: b.billNo, amount: returnRevenue, detail: `จำนวน ${money(qty)} • เหตุผล ${cleanReason}` });
  showToast(`รับคืน ${productName} แล้ว`);
}

window.returnBillItem = returnBillItem;

function renderBillReturnsHtml(billId) {
  const rows = returnItemsForBill(billId);
  if (!rows.length) return "";

  return `
    <div class="panel return-panel">
      <div class="panel-head">
        <h3>ประวัติการคืนสินค้า</h3>
        <span class="hint">${billReturnSummaryText(billId)}</span>
      </div>
      <div class="stack-list">
        ${rows.map(r => {
          const ret = state.returns.find(x => x.id === r.returnId);
          return `
            <div class="list-item return-row">
              <div>
                <strong>${r.productNameSnapshot || productById(r.productId)?.name || "-"}</strong>
                <small>${r.date || ret?.date || "-"} • จำนวนคืน ${money(r.qty)} • เหตุผล: ${r.reason || ret?.reason || "-"}</small>
                <small>คืนสต็อกด้วยทุน ${money(r.unitCost)} / หน่วย</small>
              </div>
              <div>
                <div class="money">${money(r.revenue)}</div>
                <small>ลดต้นทุน ${money(r.cost)}</small>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
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
          ${!isCancelled ? `<button class="danger-btn" onclick="cancelBill('${b.id}')">ยกเลิกบิล</button>` : `<button class="danger-btn" onclick="deleteCancelledBill('${b.id}')">ลบถาวร</button>`}
        </div>
      </div>

      <div class="bill-detail-kpis">
        <div><span>ยอดขาย</span><strong>${money(b.subtotal)}</strong></div>
        <div><span>ส่วนลด</span><strong class="discount-note">${money(b.discountTotal || 0)}</strong></div>
        <div><span>ต้นทุน</span><strong>${money(b.costTotal)}</strong></div>
        <div><span>กำไร</span><strong class="${Number(b.profitTotal || 0) >= 0 ? "positive" : "negative"}">${money(b.profitTotal)}</strong></div>
        <div><span>คืนสินค้า</span><strong class="discount-note">${money(b.returnTotal || 0)}</strong></div>
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
              <small>จำนวน ${money(item.qty)} • ราคาขาย ${money(item.unitPrice)} • ต้นทุนเฉลี่ยจาก FIFO ${money(item.unitCost)}${Number(item.discount || 0) > 0 ? ` • ลด ${money(item.discount)}` : ""}</small>${billItemLotBreakdownHtml(item)}
              ${returnedQtyForItem(item.id) > 0 ? `<small class="returned-note">คืนแล้ว ${money(returnedQtyForItem(item.id))} • เหลือคืนได้ ${money(remainingReturnQty(item))}</small>` : ""}
            </div>
            <div class="bill-item-price">
              <strong>${money(item.revenue)}</strong>
              <small class="${Number(item.profit || 0) >= 0 ? "positive" : "negative"}">กำไร ${money(item.profit)}</small>
              ${!isCancelled && remainingReturnQty(item) > 0 ? `<button class="small-btn return-action" onclick="returnBillItem('${item.id}')">คืนสินค้า</button>` : ""}
            </div>
          </div>
        `).join("") || `<div class="list-item"><div><strong>ไม่มีรายการสินค้าในบิล</strong></div></div>`}
      </div>
    </div>

    ${renderBillReturnsHtml(b.id)}

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
  if (typeof enforceRoleBeforeSwitch === "function" && !enforceRoleBeforeSwitch(id)) return;
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  if (id === "closePeriod") {
    try { renderClosePeriod(); } catch (err) { console.error("renderClosePeriod failed", err); }
  }
  if (id === "debtAging") {
    try { renderDebtAging(); } catch (err) { console.error("renderDebtAging failed", err); }
  }
  if (id === "activityLog") {
    try { renderActivityLog(); } catch (err) { console.error("renderActivityLog failed", err); }
  }
  if (id === "more") {
    try { resetMoreMenu(); } catch (err) { console.error("resetMoreMenu failed", err); }
  }
  if (id === "security") {
    try { renderPinSettings(); renderRoleSettings(); applyRolePermissions(); } catch (err) { console.error("renderRoleSettings failed", err); }
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tab,[data-open-tab]").forEach(el => el.addEventListener("click", () => switchTab(el.dataset.tab || el.dataset.openTab)));

function setDates() {
  ["billDate", "purchaseDate", "paymentDate", "adjustDate", "stockCountDate", "closeLockUntil"].forEach(id => { if ($(id)) $(id).value = today(); });
}

$("paymentType").addEventListener("change", () => {
  $("customerField").classList.toggle("hidden-field", $("paymentType").value !== "credit");
});
$("billCustomer").addEventListener("change", refreshCartPricesForCustomer);

$("saleSearch").addEventListener("input", renderSale);
$("saleCategoryFilter")?.addEventListener("change", renderSale);
$("productSearch").addEventListener("input", renderProducts);
$("productCategoryFilter")?.addEventListener("change", renderProducts);
$("customerSearch").addEventListener("input", renderCustomers);
$("ledgerSearch").addEventListener("input", renderLedger);
$("clearLedgerBtn").addEventListener("click", () => { selectedLedgerCustomerId = ""; renderLedger(); });
$("clearCartBtn").addEventListener("click", clearCart);
$("saveBillBtn").addEventListener("click", saveBill);
$("billDiscount")?.addEventListener("input", renderSale);

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
    category: $("productCategory")?.value.trim() || "",
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
  await logActivity("PRODUCT_SAVE", `${old.id ? "แก้ไข" : "เพิ่ม"}สินค้า ${name}`, { refType: "product", refId: id, detail: `หมวด ${$("productCategory")?.value || "-"} • ราคา ${money($("productPrice").value || 0)}` });
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
  await logActivity("CUSTOMER_SAVE", `${old.id ? "แก้ไข" : "เพิ่ม"}ลูกค้า ${name}`, { refType: "customer", refId: id, detail: `${$("customerType").value} • เครดิต ${$("customerDays").value || 0} วัน` });
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
  const purchaseDate = $("purchaseDate").value || today();
  if (!assertDateUnlocked(purchaseDate, editId ? "อัปเดตซื้อเข้า" : "บันทึกซื้อเข้า")) return;
  if (old && !assertDateUnlocked(old.date, "แก้ไขรายการซื้อเข้าที่อยู่ในรอบปิดแล้ว")) return;

  await put("stock_movements", {
    ...(old || {}),
    id: editId || uid(),
    productId,
    type: "purchase",
    refType: "purchase",
    refId: "",
    date: purchaseDate,
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
  await logActivity("PURCHASE_SAVE", `${editId ? "อัปเดต" : "บันทึก"}ซื้อเข้า`, { refType: "stock_movement", refId: editId || "", amount: qty * cost, detail: `${productById(productId)?.name || "-"} • จำนวน ${money(qty)} • ทุน ${money(cost)}` });
  showToast(editId ? "อัปเดตซื้อเข้าและคำนวณ FIFO ใหม่แล้ว" : "บันทึกซื้อเข้าแล้ว");
});

$("cancelPurchaseEditBtn").addEventListener("click", resetPurchaseForm);

$("paymentForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const customerId = $("paymentCustomer").value;
  const billId = $("paymentBill") ? $("paymentBill").value : "";
  const amount = Number($("paymentAmount").value || 0);
  const editId = $("paymentId").value;
  const paymentDate = $("paymentDate").value || today();

  if (!assertDateUnlocked(paymentDate, editId ? "อัปเดตรับเงิน" : "บันทึกรับเงิน")) return;
  if (!customerId) return alert("กรุณาเลือกลูกค้า");
  if (!billId) return alert("กรุณาเลือกบิลที่รับเงิน");
  if (amount <= 0) return alert("กรุณาใส่จำนวนเงิน");

  const bill = state.bills.find(b => b.id === billId);
  const old = editId ? state.payments.find(p => p.id === editId) : null;
  if (old && !assertDateUnlocked(old.date, "แก้ไขรายการรับเงินที่อยู่ในรอบปิดแล้ว")) return;
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
    date: paymentDate,
    amount,
    method: $("paymentMethod").value,
    note: $("paymentNote").value.trim(),
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await recalcBills();
  resetPaymentForm();
  await loadState();
  await logActivity(editId ? "PAYMENT_UPDATE" : "PAYMENT_CREATE", `${editId ? "อัปเดต" : "รับ"}เงินลูกหนี้`, { refType: "bill", refId: billId, refNo: bill?.billNo || "", amount, detail: `${customerName(customerId)} • ${$("paymentMethod").value}` });
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
    const adjustDate = $("adjustDate").value || today();

    if (!assertDateUnlocked(adjustDate, editId ? "อัปเดตปรับสต็อก" : "บันทึกปรับสต็อก")) return;
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
    if (old && !assertDateUnlocked(old.date, "แก้ไขรายการปรับสต็อกที่อยู่ในรอบปิดแล้ว")) return;
    await put("stock_movements", {
      ...(old || {}),
      id: editId || uid(),
      productId,
      type,
      refType: type === "cost_adjust" ? "cost" : "adjust",
      refId: "",
      date: adjustDate,
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
    await logActivity("ADJUST_SAVE", `${editId ? "อัปเดต" : "บันทึก"}ปรับสต็อก`, { refType: "stock_movement", refId: editId || "", amount: qty * cost, detail: `${productById(productId)?.name || "-"} • ${type} • จำนวน ${money(qty)} • ${note || "-"}` });
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
    const adjustDate = $("adjustDate").value || today();

    if (!assertDateUnlocked(adjustDate, editId ? "อัปเดตปรับสต็อก" : "บันทึกปรับสต็อก")) return;
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
    if (old && !assertDateUnlocked(old.date, "แก้ไขรายการปรับสต็อกที่อยู่ในรอบปิดแล้ว")) return;
    await put("stock_movements", {
      ...(old || {}),
      id: editId || uid(),
      productId,
      type,
      refType: "adjust",
      refId: "",
      date: adjustDate,
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



/* v2.3.19: Excel Legacy Import (.xlsx) */
let legacyExcelPreviewData = null;

function normalizeCellText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function legacyNumber(v, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function legacyDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  if (typeof v === "number") {
    // Excel serial normally around 30000-60000. Values like 244450 in legacy sheets are treated as unknown codes.
    if (v > 30000 && v < 70000) {
      const utc = Math.round((v - 25569) * 86400 * 1000);
      return new Date(utc).toISOString().slice(0, 10);
    }
    return today();
  }

  const s = normalizeCellText(v);
  if (!s) return today();

  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;

  const th = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (th) {
    let y = Number(th[3]);
    if (y < 100) y += 2500;
    if (y > 2400) y -= 543;
    return `${y}-${String(th[2]).padStart(2, "0")}-${String(th[1]).padStart(2, "0")}`;
  }

  return today();
}

function colLettersToIndex(ref) {
  const letters = String(ref || "").replace(/[0-9]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Browser นี้ยังไม่รองรับ DecompressionStream จึงอ่าน .xlsx ไม่ได้ กรุณาใช้ Chrome/Edge เวอร์ชันใหม่ หรือ Save as CSV ก่อน");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ไม่พบโครงสร้าง ZIP ของไฟล์ .xlsx");

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries = {};
  let ptr = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;

    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`ไฟล์ ${name} ใช้ compression method ${method} ที่ระบบยังไม่รองรับ`);

    entries[name] = data;
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function xmlString(entries, name) {
  const data = entries[name];
  if (!data) return "";
  return new TextDecoder("utf-8").decode(data);
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  return [...xml.getElementsByTagName("si")].map(si => {
    return [...si.getElementsByTagName("t")].map(t => t.textContent || "").join("");
  });
}

function parseXlsxSheet(xmlText, sharedStrings) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const rows = [];
  for (const row of [...xml.getElementsByTagName("row")]) {
    const rIndex = Math.max(0, Number(row.getAttribute("r") || (rows.length + 1)) - 1);
    const arr = rows[rIndex] || [];
    for (const c of [...row.getElementsByTagName("c")]) {
      const ref = c.getAttribute("r") || "";
      const col = colLettersToIndex(ref);
      const type = c.getAttribute("t") || "";
      let value = "";

      if (type === "inlineStr") {
        value = [...c.getElementsByTagName("t")].map(t => t.textContent || "").join("");
      } else {
        const vEl = c.getElementsByTagName("v")[0];
        const raw = vEl ? (vEl.textContent || "") : "";
        if (type === "s") value = sharedStrings[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1";
        else if (raw !== "" && !Number.isNaN(Number(raw))) value = Number(raw);
        else value = raw;
      }

      arr[col] = value;
    }
    rows[rIndex] = arr;
  }
  return rows;
}

async function readXlsxFirstSheet(file) {
  const entries = await unzipXlsx(await file.arrayBuffer());
  const shared = parseSharedStrings(xmlString(entries, "xl/sharedStrings.xml"));
  const sheetName = Object.keys(entries).find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)) || "xl/worksheets/sheet1.xml";
  const sheetXml = xmlString(entries, sheetName);
  if (!sheetXml) throw new Error("ไม่พบ worksheet ในไฟล์ Excel");
  return parseXlsxSheet(sheetXml, shared);
}

function legacyGroupName(value) {
  const s = normalizeCellText(value);
  if (!s) return "";
  const parts = s.split("/");
  return normalizeCellText(parts.length > 1 ? parts.slice(1).join("/") : s);
}

function analyzeLegacyExcelRows(rows, fileName) {
  const headerIndex = rows.findIndex(r => normalizeCellText(r?.[0]).includes("ชื่อสินค้า"));
  if (headerIndex < 0) throw new Error("ไม่พบหัวคอลัมน์ 'ชื่อสินค้า' ในไฟล์ Excel");

  const h1 = rows[headerIndex] || [];
  const h2 = rows[headerIndex + 1] || [];
  const groups = [];

  for (let c = 0; c < h1.length; c++) {
    const head = normalizeCellText(h1[c]);
    if (!head) continue;

    if (head.includes("ยอดขายปลีก")) {
      groups.push({ key: "retail", name: "ขายปลีก/เงินสด", customerName: "", paymentType: "cash", type: "retail", qtyCol: c, priceCol: c + 1, amountCol: c + 2 });
    } else if (head.includes("ยอดขายส่ง")) {
      const name = legacyGroupName(head) || `ลูกค้าขายส่ง ${groups.length + 1}`;
      groups.push({ key: `wholesale-${name}`, name, customerName: name, paymentType: "credit", type: "wholesale", qtyCol: c, priceCol: c + 1, amountCol: c + 2 });
    } else if (head.includes("เงินสด") || head.includes("หม่าล่า")) {
      groups.push({ key: "cash", name: head, customerName: "", paymentType: "cash", type: "cash", qtyCol: c, priceCol: c + 1, amountCol: c + 2 });
    }
  }

  const products = [];
  const customers = new Map();
  const billMap = new Map();
  const warnings = [];

  groups.filter(g => g.paymentType === "credit" && g.customerName).forEach(g => {
    customers.set(g.customerName, { name: g.customerName, type: "ขายส่ง", creditDays: 0, creditLimit: 0, note: `นำเข้าจาก Excel ${fileName}` });
  });

  for (let r = headerIndex + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = normalizeCellText(row[0]);
    if (!name) continue;
    if (name.includes("รวม") || name.includes("TOTAL")) continue;

    const openingQty = legacyNumber(row[2], 0);
    const unitCostFromCol = legacyNumber(row[3], 0);
    const totalCost = legacyNumber(row[4], 0);
    const unitCost = unitCostFromCol || (openingQty ? totalCost / openingQty : 0);
    const remaining = legacyNumber(row[20], openingQty);
    const date = legacyDate(row[1]);
    const rawDateValue = row[1];
    const rawDateText = normalizeCellText(rawDateValue);
    if (rawDateText && typeof rawDateValue === "number" && !(rawDateValue > 30000 && rawDateValue < 70000)) {
      warnings.push(`แถว ${r + 1}: ${name} วันที่ใน Excel เป็น ${rawDateText} ซึ่งไม่ใช่วันที่มาตรฐาน ระบบจะใช้วันที่ปัจจุบันแทน`);
    }

    if (openingQty <= 0 && totalCost <= 0) {
      warnings.push(`แถว ${r + 1}: ${name} ไม่มีจำนวน/ทุน ระบบจะข้ามสต็อกเริ่มต้น`);
    }

    const product = {
      rowNumber: r + 1,
      name,
      unit: "ชิ้น",
      category: "Legacy Excel",
      openingQty,
      remaining,
      unitCost,
      totalCost: totalCost || openingQty * unitCost,
      date,
      note: `นำเข้าจาก Excel ${fileName} แถว ${r + 1}`,
      price: 0,
      wholesalePrice: 0
    };

    // Detect sale prices and bill items from groups
    const saleItems = [];
    for (const g of groups) {
      const qty = legacyNumber(row[g.qtyCol], 0);
      const amount = legacyNumber(row[g.amountCol], 0);
      const priceCell = legacyNumber(row[g.priceCol], 0);
      const unitPrice = priceCell || (qty ? amount / qty : 0);

      if (qty > 0 || amount > 0) {
        if (qty <= 0) {
          warnings.push(`แถว ${r + 1}: ${name} กลุ่ม ${g.name} มียอดเงินแต่ไม่มีจำนวน ระบบจะข้ามรายการขายนี้`);
          continue;
        }

        const price = unitPrice || product.price || product.wholesalePrice || unitCost;
        saleItems.push({ group: g, qty, unitPrice: price, amount: amount || qty * price });
        if (g.type === "retail" || g.type === "cash") product.price = product.price || price;
        if (g.type === "wholesale") product.wholesalePrice = product.wholesalePrice || price;
      }
    }

    if (!product.price) product.price = product.wholesalePrice || unitCost;
    if (!product.wholesalePrice) product.wholesalePrice = product.price;

    products.push(product);

    for (const item of saleItems) {
      const g = item.group;
      const billKey = `${g.key}|${product.date}`;
      const bill = billMap.get(billKey) || {
        key: billKey,
        date: product.date,
        groupName: g.name,
        customerName: g.customerName,
        paymentType: g.paymentType,
        type: g.type,
        items: []
      };
      bill.items.push({
        productName: product.name,
        rowNumber: product.rowNumber,
        qty: item.qty,
        unitPrice: item.unitPrice,
        unitCost: product.unitCost,
        revenue: item.qty * item.unitPrice,
        cost: item.qty * product.unitCost
      });
      billMap.set(billKey, bill);
    }

    const totalSalesQty = saleItems.reduce((s, x) => s + Number(x.qty || 0), 0);
    if (openingQty && Math.abs(openingQty - totalSalesQty - remaining) > 0.01) {
      warnings.push(`แถว ${r + 1}: ${name} จำนวนเริ่มต้น ${money(openingQty)} - ขาย ${money(totalSalesQty)} ไม่ตรงกับคงเหลือ ${money(remaining)}`);
    }
  }

  const bills = [...billMap.values()].filter(b => b.items.length);
  const customersOut = [...customers.values()];

  if (!bills.length) {
    warnings.unshift("ไม่พบบิลที่จะสร้าง เพราะไม่พบจำนวนขายในคอลัมน์ยอดขายปลีก/ยอดขายส่ง/เงินสด ระบบจะนำเข้าเฉพาะสินค้า ลูกค้า และสต็อกเริ่มต้น");
  }
  if (customersOut.length && !bills.length) {
    warnings.unshift(`พบลูกค้า ${customersOut.length} คนจากหัวคอลัมน์ แต่ยังไม่มีบิล เพราะยังไม่มีจำนวนขายในช่องของลูกค้า`);
  }
  if (!groups.length) {
    warnings.unshift("ไม่พบกลุ่มยอดขาย เช่น ยอดขายส่ง / ชื่อลูกค้า หรือ เงินสด ระบบจะนำเข้าได้เฉพาะสินค้า/สต็อก");
  }

  return {
    fileName,
    headerRow: headerIndex + 1,
    groups,
    products,
    customers: customersOut,
    bills,
    warnings,
    importMode: bills.length ? "full" : "opening_only"
  };
}

function renderLegacyExcelPreview(data) {
  legacyExcelPreviewData = data;
  $("legacyExcelPreviewPanel")?.classList.remove("hidden-field");
  if ($("legacyExcelFileName")) $("legacyExcelFileName").textContent = data.fileName || "-";

  const openingValue = data.products.reduce((s, p) => s + Number(p.openingQty || 0) * Number(p.unitCost || 0), 0);
  const saleValue = data.bills.reduce((s, b) => s + b.items.reduce((x, i) => x + Number(i.revenue || 0), 0), 0);
  const importMode = data.bills.length ? "นำเข้าพร้อมบิล" : "ตั้งต้นสินค้า/ลูกค้า";
  const importModeHint = data.bills.length
    ? "ระบบพบข้อมูลขายใน Excel และจะสร้างบิลตามลูกค้า/เงินสดที่ตรวจพบ"
    : "ระบบไม่พบจำนวนขายในช่องลูกค้า/เงินสด จึงจะนำเข้าเฉพาะสินค้า ลูกค้า และสต็อกเริ่มต้น";

  $("legacyExcelPreviewSummary").innerHTML = `
    <div><span>โหมด Import</span><strong>${importMode}</strong></div>
    <div><span>สินค้า</span><strong>${data.products.length.toLocaleString("th-TH")}</strong></div>
    <div><span>ลูกค้า</span><strong>${data.customers.length.toLocaleString("th-TH")}</strong></div>
    <div><span>บิลที่จะสร้าง</span><strong>${data.bills.length.toLocaleString("th-TH")}</strong></div>
    <div><span>มูลค่าสต็อกเริ่มต้น</span><strong>${money(openingValue)}</strong></div>
    <div><span>ยอดขายจากไฟล์</span><strong>${money(saleValue)}</strong></div>
  `;

  if ($("legacyExcelModeNotice")) {
    $("legacyExcelModeNotice").className = `legacy-mode-notice ${data.bills.length ? "" : "warn"}`;
    $("legacyExcelModeNotice").innerHTML = `
      <strong>${data.bills.length ? "พบข้อมูลขายและสามารถสร้างบิลได้" : "รอบนี้ยังไม่สร้างบิล"}</strong><br>
      ${importModeHint}<br>
      ${!data.bills.length ? "ถ้าต้องการให้สร้างบิล ให้กรอกจำนวนขายและราคา/ยอดเงินในคอลัมน์ ยอดขายส่ง/ลูกค้า หรือ เงินสด ใน Excel ก่อนนำเข้า" : ""}
    `;
  }

  if ($("legacyExcelDetectedGroups")) {
    $("legacyExcelDetectedGroups").innerHTML = data.groups.map(g => `
      <span class="legacy-group-chip ${g.paymentType === "cash" ? "cash" : ""}">
        ${g.paymentType === "cash" ? "เงินสด" : "เครดิต"}: ${safeText(g.name)}
      </span>
    `).join("") || `<span class="legacy-group-chip cash">ไม่พบกลุ่มยอดขาย</span>`;
  }

  const warningHtml = data.warnings.slice(0, 20).map(w => `<div class="legacy-warning">⚠️ ${safeText(w)}</div>`).join("");
  const infoHtml = !data.bills.length
    ? `<div class="legacy-warning info">ℹ️ ตัวอย่างที่จะสร้างบิลได้: ช่อง “ยอดขายส่ง / แนน” ต้องมีจำนวนขาย เช่น 2 และราคาหรือยอดเงิน เช่น 80/160</div>`
    : `<div class="legacy-warning good">✅ พบ ${data.bills.length} บิลที่จะสร้างจาก Excel กรุณาตรวจ Preview ก่อนยืนยัน</div>`;

  $("legacyExcelWarnings").innerHTML = infoHtml + warningHtml;

  const previewRows = [
    ...data.products.slice(0, 8).map(p => ({
      kind: "สินค้า",
      title: p.name,
      warn: false,
      detail: `สินค้า • แถว ${p.rowNumber} • จำนวนเริ่มต้น ${money(p.openingQty)} • คงเหลือใน Excel ${money(p.remaining)} • ทุน/หน่วย ${money(p.unitCost)}`
    })),
    ...data.customers.slice(0, 6).map(c => ({
      kind: "ลูกค้า",
      title: c.name,
      warn: false,
      detail: `ลูกค้าขายส่ง • เครดิต ${c.creditDays || 0} วัน • สร้างจากหัวคอลัมน์ยอดขายส่ง`
    })),
    ...data.bills.slice(0, 8).map(b => ({
      kind: "บิล",
      title: `${b.paymentType === "credit" ? "บิลเครดิต" : "บิลเงินสด"} ${b.customerName || b.groupName}`,
      warn: false,
      detail: `${b.date} • ${b.items.length} รายการ • ยอด ${money(b.items.reduce((s, i) => s + i.revenue, 0))}`
    }))
  ];

  $("legacyExcelPreviewRows").innerHTML = previewRows.map(r => `
    <div class="list-item legacy-preview-row ${r.warn ? "warn" : ""}">
      <div>
        <strong>${safeText(r.title)} <span class="activity-chip">${safeText(r.kind)}</span></strong>
        <small>${safeText(r.detail)}</small>
      </div>
    </div>
  `).join("") || `<div class="list-item empty-card"><div><strong>ไม่พบข้อมูลที่นำเข้าได้</strong><small>ตรวจหัวคอลัมน์และรูปแบบไฟล์ Excel อีกครั้ง</small></div></div>`;
}

async function previewLegacyExcelFile(file) {
  if (!file) return;
  try {
    showToast("กำลังอ่านไฟล์ Excel...");
    const rows = await readXlsxFirstSheet(file);
    const data = analyzeLegacyExcelRows(rows, file.name);
    renderLegacyExcelPreview(data);
    showToast("อ่านไฟล์ Excel สำเร็จ");
  } catch (err) {
    console.error(err);
    legacyExcelPreviewData = null;
    alert(`อ่านไฟล์ Excel ไม่สำเร็จ\n\n${err.message || err}`);
  }
}

async function importLegacyExcelData() {
  const data = legacyExcelPreviewData;
  if (!data) return alert("กรุณาเลือกไฟล์ Excel และรอ Preview ก่อน");

  if (!assertDateUnlocked(today(), "Import Excel เดิม")) return;

  const billMessage = data.bills.length
    ? `บิลที่จะสร้าง ${data.bills.length} บิล`
    : "ยังไม่สร้างบิล เพราะไม่พบจำนวนขายในช่องลูกค้า/เงินสด";
  const confirmText = `ยืนยัน Import Excel เดิม?\n\nสินค้า ${data.products.length} รายการ\nลูกค้า ${data.customers.length} คน\n${billMessage}\n\nระบบจะสร้างสินค้า, ลูกค้า และ opening stock/FIFO จากไฟล์ Excel${data.bills.length ? "\nรวมถึงสร้างบิลจากยอดขายที่ตรวจพบ" : ""}\n\nแนะนำให้ Backup ก่อน Import`;
  if (!confirm(confirmText)) return;

  const importId = `LEGACY-${Date.now()}`;
  const nowBase = Date.now();
  const productIdByName = new Map();
  let createdProducts = 0;
  let updatedProducts = 0;
  let createdCustomers = 0;
  let createdBills = 0;
  let skippedBills = 0;

  // Products + opening stock
  for (let i = 0; i < data.products.length; i++) {
    const row = data.products[i];
    const existing = state.products.find(p => !p.isArchived && normalizeCellText(p.name) === normalizeCellText(row.name));
    const productId = existing?.id || uid();
    productIdByName.set(row.name, productId);

    await put("products", {
      ...(existing || {}),
      id: productId,
      name: row.name,
      unit: existing?.unit || row.unit || "ชิ้น",
      category: existing?.category || row.category || "Legacy Excel",
      price: Number(existing?.price || row.price || row.unitCost || 0),
      wholesalePrice: Number(existing?.wholesalePrice || row.wholesalePrice || row.price || row.unitCost || 0),
      minStock: Number(existing?.minStock || 0),
      note: existing?.note || row.note,
      stockQty: Number(existing?.stockQty || 0),
      avgCost: Number(existing?.avgCost || row.unitCost || 0),
      isArchived: false,
      createdAt: existing?.createdAt || new Date(nowBase + i).toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (existing) updatedProducts += 1;
    else createdProducts += 1;

    if (row.openingQty > 0 || row.unitCost > 0) {
      const openingNote = `LEGACY-EXCEL-OPENING:${data.fileName}:${row.name}`;
      const oldOpening = state.stock_movements.find(m => (m.note || "") === openingNote);
      await put("stock_movements", {
        ...(oldOpening || {}),
        id: oldOpening?.id || uid(),
        productId,
        type: "opening",
        refType: "legacy_excel",
        refId: importId,
        date: row.date || today(),
        qtyIn: Math.max(0, Number(row.openingQty || 0)),
        qtyOut: 0,
        unitCost: Math.max(0, Number(row.unitCost || 0)),
        note: openingNote,
        createdAt: oldOpening?.createdAt || new Date(nowBase + 1000 + i).toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  await loadState();

  // Customers
  const customerIdByName = new Map();
  for (let i = 0; i < data.customers.length; i++) {
    const row = data.customers[i];
    const existing = state.customers.find(c => normalizeCellText(c.name) === normalizeCellText(row.name));
    const customerId = existing?.id || uid();
    customerIdByName.set(row.name, customerId);

    await put("customers", {
      ...(existing || {}),
      id: customerId,
      name: row.name,
      type: existing?.type || row.type || "ขายส่ง",
      phone: existing?.phone || "",
      creditLimit: Number(existing?.creditLimit || row.creditLimit || 0),
      creditDays: Number(existing?.creditDays || row.creditDays || 0),
      note: existing?.note || row.note,
      createdAt: existing?.createdAt || new Date(nowBase + 2000 + i).toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (!existing) createdCustomers += 1;
  }

  await loadState();

  // Bills
  let movementCounter = 0;
  for (const billData of data.bills) {
    const sourceNote = `LEGACY-EXCEL-BILL:${data.fileName}:${billData.date}:${billData.groupName}`;
    if (state.bills.some(b => (b.note || "").includes(sourceNote))) {
      skippedBills += 1;
      continue;
    }

    const billId = uid();
    const billNo = nextBillNo();
    const customerId = billData.customerName ? (customerIdByName.get(billData.customerName) || state.customers.find(c => c.name === billData.customerName)?.id || "") : "";
    const subtotal = billData.items.reduce((s, i) => s + Number(i.revenue || 0), 0);
    const costTotal = billData.items.reduce((s, i) => s + Number(i.cost || 0), 0);
    const paymentType = billData.paymentType;
    const paidAmount = paymentType === "cash" ? subtotal : 0;
    const creditAmount = paymentType === "credit" ? subtotal : 0;

    await put("bills", {
      id: billId,
      billNo,
      date: billData.date || today(),
      customerId,
      paymentType,
      grossTotal: subtotal,
      itemDiscountTotal: 0,
      billDiscount: 0,
      discountTotal: 0,
      subtotal,
      costTotal,
      profitTotal: subtotal - costTotal,
      paidAmount,
      initialPaidAmount: paidAmount,
      creditAmount,
      status: creditAmount > 0 ? "credit" : "paid",
      note: `${sourceNote} • Import Excel เดิม`,
      createdAt: new Date(nowBase + 3000 + createdBills).toISOString()
    });

    for (const item of billData.items) {
      const productId = productIdByName.get(item.productName) || state.products.find(p => p.name === item.productName)?.id;
      if (!productId) continue;

      const billItemId = uid();
      await put("bill_items", {
        id: billItemId,
        billId,
        productId,
        productNameSnapshot: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        grossRevenue: item.revenue,
        discount: 0,
        revenue: item.revenue,
        cost: item.cost,
        profit: item.revenue - item.cost
      });

      await put("stock_movements", {
        id: uid(),
        productId,
        type: "sale",
        refType: "bill",
        refId: billId,
        date: billData.date || today(),
        qtyIn: 0,
        qtyOut: item.qty,
        unitCost: item.unitCost,
        note: `ขายบิล ${billNo} • ${sourceNote}`,
        createdAt: new Date(nowBase + 4000 + movementCounter++).toISOString()
      });
    }

    await incrementBillNo();
    createdBills += 1;
    await loadState();
  }

  await recomputeInventory();
  await recalcBills();
  await loadState();

  await logActivity("BACKUP_IMPORT", `Import Excel เดิม ${data.fileName}`, {
    refType: "legacy_excel",
    refId: importId,
    amount: createdBills,
    detail: `สินค้าใหม่ ${createdProducts} • อัปเดตสินค้า ${updatedProducts} • ลูกค้าใหม่ ${createdCustomers} • บิลใหม่ ${createdBills} • ข้ามบิลซ้ำ ${skippedBills}`
  });

  legacyExcelPreviewData = null;
  if ($("legacyExcelInput")) $("legacyExcelInput").value = "";
  $("legacyExcelPreviewPanel")?.classList.add("hidden-field");
  showToast(`Import Excel สำเร็จ: สินค้า ${createdProducts + updatedProducts}, ลูกค้าใหม่ ${createdCustomers}, บิลใหม่ ${createdBills}${createdBills ? "" : " (นำเข้าเฉพาะตั้งต้น)"}`);
}

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


function backupPreviewData(data) {
  const stores = ["products","customers","bills","bill_items","payments","stock_movements","stock_lots","bill_item_lots","returns","return_items","stock_counts","stock_count_items","close_periods","settings"];
  const counts = {};
  stores.forEach(s => counts[s] = Array.isArray(data?.[s]) ? data[s].length : 0);
  return counts;
}

function backupPreviewText(data) {
  const c = backupPreviewData(data);
  return [
    `App: ${data?.app || "-"}`,
    `Version: ${data?.version || "-"}`,
    `Exported: ${data?.exportedAt ? new Date(data.exportedAt).toLocaleString("th-TH") : "-"}`,
    `สินค้า: ${c.products}`,
    `ลูกค้า: ${c.customers}`,
    `บิล: ${c.bills}`,
    `รายการบิล: ${c.bill_items}`,
    `รับเงิน: ${c.payments}`,
    `Stock movement: ${c.stock_movements}`,
    `FIFO lots: ${c.stock_lots}`,
    `ปิดรอบ: ${c.close_periods}`
  ].join("\n");
}

function confirmRestoreWithPreview(data) {
  const text = backupPreviewText(data);
  const ok1 = confirm(`ตรวจไฟล์ Backup ก่อน Restore\n\n${text}\n\nการ Restore จะนำเข้าข้อมูลจากไฟล์นี้ และอาจทับข้อมูลเดิมในเครื่องนี้\n\nต้องการดำเนินการต่อหรือไม่?`);
  if (!ok1) return false;

  const typed = prompt(`ยืนยัน Restore Backup\n\nพิมพ์คำว่า RESTORE เพื่อยืนยันการนำเข้าข้อมูล:`);
  return typed === "RESTORE";
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
  const rows = [["billNo", "date", "customer", "grossTotal", "discountTotal", "returnTotal", "subtotal", "cost", "profit", "status"]];
  filteredBills().forEach(b => rows.push([b.billNo, b.date, customerName(b.customerId), b.grossTotal || b.subtotal, b.discountTotal || 0, b.returnTotal || 0, b.subtotal, b.costTotal, b.profitTotal, b.status]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`khaikhong-v2-report-${today()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
});

$("exportBackupBtn").addEventListener("click", () => {
  const data = { app: "Khaikhong", version: "2.3.20", exportedAt: new Date().toISOString(), ...state };
  localStorage.setItem("khaikhongV2LastBackup", new Date().toISOString());
  download(`khaikhong-v2-backup-${today()}.json`, JSON.stringify(data, null, 2), "application/json");
  renderBackupStatus();
  logActivity("BACKUP_EXPORT", "Export Backup", { detail: `สินค้า ${state.products.length} • ลูกค้า ${state.customers.length} • บิล ${state.bills.length}` });
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
  await logActivity("BACKUP_IMPORT", "Restore Backup", { detail: `นำเข้าไฟล์ ${file.name || "backup"}` });
  showToast("นำเข้า Backup แล้ว");
});

$("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("ล้างข้อมูลทั้งหมด? แนะนำให้ Backup ก่อน")) return;

  for (const s of STORES) await clearStore(s);
  cart = [];
  await loadState();
  await logActivity("CLEAR_ALL", "ล้างข้อมูลทั้งหมด", { detail: "ล้างข้อมูลในเครื่องนี้ทั้งหมด" });
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
    ["ชื่อสินค้า", "หน่วย", "หมวดหมู่", "ราคาขายปลีก", "ราคาขายส่ง", "สต็อกเริ่มต้น", "ทุนเริ่มต้น", "สต็อกขั้นต่ำ", "หมายเหตุ"],
    ["ปูอัด", "แพ็ค", "อาหารแช่แข็ง", "100", "90", "10", "60", "2", "ตัวอย่างสินค้า"],
    ["ลูกชิ้น", "ถุง", "อาหารแช่แข็ง", "80", "70", "20", "45", "5", ""]
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
      category: getCsvValue(row, ["หมวดหมู่", "category", "หมวด"]).trim(),
      price: Number(getCsvValue(row, ["ราคาขายปลีก", "ราคาขาย", "price", "ขาย"]) || 0),
      wholesalePrice: Number(getCsvValue(row, ["ราคาขายส่ง", "wholesalePrice", "ส่ง"]) || getCsvValue(row, ["ราคาขายปลีก", "ราคาขาย", "price", "ขาย"]) || 0),
      openingStock: Number(getCsvValue(row, ["สต็อกเริ่มต้น", "จำนวนเริ่มต้น", "stockQty", "stock"]) || 0),
      openingCost: Number(getCsvValue(row, ["ทุนเริ่มต้น", "ต้นทุนเริ่มต้น", "avgCost", "cost", "ทุน"]) || 0),
      minStock: Number(getCsvValue(row, ["สต็อกขั้นต่ำ", "minStock", "ขั้นต่ำ"]) || 0),
      note: getCsvValue(row, ["หมายเหตุ", "note"]).trim()
    }))
    .filter(row => row.name);

  if (!valid.length) {
    alert("ไม่พบข้อมูลสินค้าใน CSV");
    e.target.value = "";
    return;
  }

  if (!assertDateUnlocked(today(), "Import สินค้า/สต็อกเริ่มต้น")) { e.target.value = ""; return; }

  if (!confirm(`นำเข้าสินค้า ${valid.length} รายการ?\n\nระบบจะเพิ่ม/อัปเดตสินค้า และถ้ามีสต็อกเริ่มต้นจะสร้างรายการ opening stock`)) {
    e.target.value = "";
    return;
  }

  for (const row of valid) {
    const existing = state.products.find(p => !p.isArchived && (p.name || "").trim() === row.name);
    const productId = existing?.id || uid();
    await put("products", {
      ...(existing || {}),
      id: productId,
      name: row.name,
      unit: row.unit,
      category: row.category,
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

    if (row.openingStock > 0 || row.openingCost > 0) {
      const openingNote = `IMPORT-CSV-OPENING:${productId}`;
      const oldOpening = state.stock_movements.find(m => m.productId === productId && (m.note || "") === openingNote);
      await put("stock_movements", {
        ...(oldOpening || {}),
        id: oldOpening?.id || uid(),
        productId,
        type: "opening",
        refType: "opening",
        refId: "",
        date: today(),
        qtyIn: Math.max(0, row.openingStock),
        qtyOut: 0,
        unitCost: Math.max(0, row.openingCost),
        note: openingNote,
        createdAt: oldOpening?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  await recomputeInventory();
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
  if (!confirm("ตรวจ/ซ่อม FIFO ทั้งระบบ?\\n\\nระบบจะสร้างล็อตต้นทุนใหม่จากประวัติซื้อเข้า/สต็อกเริ่มต้น และคำนวณต้นทุนขาย/กำไรของบิลทั้งหมดใหม่")) return;
  await recomputeInventory();
  await loadState();
  await logActivity("FIFO_REPAIR", "ตรวจ/ซ่อม FIFO", { detail: "คำนวณล็อตต้นทุนและกำไรใหม่ทั้งระบบ" });
  showToast("ตรวจ/ซ่อม FIFO เรียบร้อยแล้ว");
  if ($("testResults")) {
    showTestResults([{ status: "info", title: "ตรวจ/ซ่อม FIFO เรียบร้อย", detail: "ระบบสร้างล็อตต้นทุน คำนวณต้นทุนขาย กำไรบิล สต็อก และทุน FIFO คงเหลือใหม่แล้ว" }, ...runSystemChecks()]);
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
  const b = state.bills.find(x => x.id === billId) || {};
  const items = billItems(billId);
  const lineSubtotal = items.reduce((s, i) => s + Number(i.revenue || 0), 0);
  const costTotal = items.reduce((s, i) => s + Number(i.cost || 0), 0);
  const billDiscount = Math.min(Math.max(Number(b.billDiscount || 0), 0), Math.max(0, lineSubtotal));
  const subtotal = Math.max(0, lineSubtotal - billDiscount);
  return {
    subtotal,
    costTotal,
    profitTotal: subtotal - costTotal,
    count: items.length
  };
}

async function ensureTestProduct({ name, unit, category = "TEST", price, minStock, note }) {
  const existing = state.products.find(p => (p.name || "") === name);
  if (existing) return existing;

  const item = {
    id: uid(),
    name,
    unit,
    category,
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
$("repairFifoBtn")?.addEventListener("click", repairAllCosts);

["billSearchText", "billSearchItem", "billSearchFrom", "billSearchTo", "billSearchCustomer", "billSearchStatus", "billSearchPaymentType"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderBillSearch);
  if ($(id)) $(id).addEventListener("change", renderBillSearch);
});
$("billSearchTodayBtn")?.addEventListener("click", () => setBillSearchRange("today"));
$("billSearchYesterdayBtn")?.addEventListener("click", () => setBillSearchRange("yesterday"));
$("billSearch7DaysBtn")?.addEventListener("click", () => setBillSearchRange("7days"));
$("billSearchMonthBtn")?.addEventListener("click", () => setBillSearchRange("month"));
$("billSearchClearBtn")?.addEventListener("click", clearBillSearch);
$("exportBillSearchCsvBtn")?.addEventListener("click", exportBillSearchCsv);


["customerHistoryFrom", "customerHistoryTo", "customerHistoryItemSearch", "customerHistoryView", "customerHistoryIncludeCancelled"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderCustomerDetail);
  if ($(id)) $(id).addEventListener("change", renderCustomerDetail);
});
$("customerHistoryTodayBtn")?.addEventListener("click", () => setCustomerHistoryRange("today"));
$("customerHistory7DaysBtn")?.addEventListener("click", () => setCustomerHistoryRange("7days"));
$("customerHistoryMonthBtn")?.addEventListener("click", () => setCustomerHistoryRange("month"));
$("customerHistoryPrevMonthBtn")?.addEventListener("click", () => setCustomerHistoryRange("prevMonth"));
$("customerHistoryClearBtn")?.addEventListener("click", clearCustomerHistoryFilters);
$("copyCustomerHistoryBtn")?.addEventListener("click", copyCustomerHistory);
$("printCustomerHistoryBtn")?.addEventListener("click", printCustomerHistory);
$("exportCustomerHistoryCsvBtn")?.addEventListener("click", exportCustomerHistoryCsv);





function appVersion() {
  const m = document.querySelector(".eyebrow")?.textContent || "Khaikhong";
  const found = m.match(/v\d+\.\d+\.\d+/);
  return found ? found[0] : "v2.2.9";
}

function lastBackupTime() {
  return localStorage.getItem("khaikhongV2LastBackup");
}

function backupAgeHours() {
  const t = lastBackupTime();
  if (!t) return Infinity;
  return (Date.now() - new Date(t).getTime()) / 36e5;
}

function betaCounts() {
  return {
    products: activeProducts().length,
    productsWithStock: activeProducts().filter(p => Number(p.stockQty || 0) > 0).length,
    customers: state.customers.length,
    bills: state.bills.length,
    billsActive: state.bills.filter(b => b.status !== "cancelled").length,
    payments: state.payments.length,
    movements: state.stock_movements.length,
    stockLots: (state.stock_lots || []).length,
    billItemLots: (state.bill_item_lots || []).length,
    returns: (state.returns || []).length,
    returnItems: (state.return_items || []).length,
    stockCounts: (state.stock_counts || []).length,
    stockCountItems: (state.stock_count_items || []).length,
    closePeriods: (state.close_periods || []).length,
    activityLogs: (state.activity_logs || []).length,
    currentLockDate: currentLockDate() || "ยังไม่ล็อก",
    pinEnabled: isPinEnabled() ? "เปิด" : "ปิด",
    lowStock: lowStockProducts ? lowStockProducts().length : 0
  };
}

function betaChecklist() {
  const counts = betaCounts();
  const s = mainSettings();
  const backupTime = lastBackupTime();
  const hasSettings = !!state.settings.find(x => x.id === "main");
  const hasRecentBackup = backupAgeHours() <= 24;
  const hasAnyBackup = !!backupTime;

  return [
    {
      key: "settings",
      title: "ตั้งค่าร้านแล้ว",
      detail: hasSettings ? `ชื่อร้าน: ${s.shopName || "Khaikhong"} • เลขบิลถัดไป ${nextBillNo()}` : "ยังไม่ได้บันทึกหน้า ตั้งค่า",
      status: hasSettings ? "pass" : "warn",
      action: "ตั้งค่าร้าน",
      tab: "settings"
    },
    {
      key: "products",
      title: "มีสินค้าในระบบ",
      detail: counts.products ? `${counts.products} รายการ` : "ควรเพิ่มสินค้า หรือ Import CSV ก่อนใช้งานจริง",
      status: counts.products ? "pass" : "bad",
      action: "ไปสินค้า",
      tab: "products"
    },
    {
      key: "stock",
      title: "มีสินค้าที่มีสต็อก",
      detail: counts.productsWithStock ? `${counts.productsWithStock} รายการมีสต็อก` : "ควรซื้อเข้า หรือ Import สต็อกเริ่มต้น",
      status: counts.productsWithStock ? "pass" : "warn",
      action: "ซื้อเข้า",
      tab: "purchase"
    },
    {
      key: "customers",
      title: "มีข้อมูลลูกค้า",
      detail: counts.customers ? `${counts.customers} รายการ` : "ถ้าขายเครดิต/ขายส่ง ควรเพิ่มลูกค้าก่อน",
      status: counts.customers ? "pass" : "warn",
      action: "ไปลูกค้า",
      tab: "customers"
    },
    {
      key: "backup",
      title: "Backup ข้อมูล",
      detail: hasAnyBackup ? `ล่าสุด: ${new Date(backupTime).toLocaleString("th-TH")}` : "ยังไม่เคย Backup",
      status: hasRecentBackup ? "pass" : (hasAnyBackup ? "warn" : "bad"),
      action: "Backup",
      tab: "backup"
    },
    {
      key: "test",
      title: "ทดสอบระบบพื้นฐาน",
      detail: counts.bills ? `มีบิลแล้ว ${counts.bills} บิล` : "แนะนำให้ลองขายเงินสด/เครดิตก่อนใช้จริง",
      status: counts.bills ? "pass" : "warn",
      action: "ทดสอบระบบ",
      tab: "testCenter"
    }
  ];
}

function renderBetaReady() {
  if (!$("betaChecklistList")) return;

  const checklist = betaChecklist();
  const pass = checklist.filter(x => x.status === "pass").length;
  const warn = checklist.filter(x => x.status === "warn").length;
  const bad = checklist.filter(x => x.status === "bad").length;
  $("betaReadySummary").textContent = `ผ่าน ${pass} / ควรเช็ก ${warn} / ต้องทำ ${bad}`;

  $("betaChecklistList").innerHTML = checklist.map(item => `
    <div class="list-item beta-check-${item.status}">
      <div>
        <strong>${item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌"} ${item.title}</strong>
        <small>${item.detail}</small>
      </div>
      <div class="row-actions">
        <span class="beta-check-chip ${item.status}">${item.status === "pass" ? "พร้อม" : item.status === "warn" ? "ควรเช็ก" : "ต้องทำ"}</span>
        <button class="small-btn" onclick="switchTab('${item.tab}')">${item.action}</button>
      </div>
    </div>
  `).join("");

  const backupTime = lastBackupTime();
  const age = backupAgeHours();
  if ($("betaBackupStatus")) $("betaBackupStatus").textContent = backupTime ? `ล่าสุด: ${new Date(backupTime).toLocaleString("th-TH")}` : "ยังไม่เคย Backup";

  const advice = $("betaBackupAdvice");
  if (advice) {
    advice.classList.remove("ok");
    if (!backupTime) {
      advice.textContent = "ยังไม่เคย Backup ข้อมูล แนะนำให้ Backup ก่อนเริ่มใช้กับข้อมูลจริง";
    } else if (age > 24) {
      advice.textContent = "Backup ล่าสุดเกิน 24 ชั่วโมงแล้ว แนะนำให้ Backup ใหม่ก่อนปิดร้านหรือก่อนอัปเดตระบบ";
    } else {
      advice.textContent = "Backup ล่าสุดยังใหม่อยู่ แต่ควร Backup อีกครั้งหลังขายจริงหรือเพิ่มข้อมูลสำคัญ";
      advice.classList.add("ok");
    }
  }

  renderDiagnosticCards();
}

function diagnosticData() {
  const counts = betaCounts();
  return {
    version: appVersion(),
    url: location.href,
    userAgent: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    platform: navigator.platform || "-",
    online: navigator.onLine ? "online" : "offline",
    dbName: DB_NAME,
    products: counts.products,
    productsWithStock: counts.productsWithStock,
    lowStock: counts.lowStock,
    customers: counts.customers,
    bills: counts.bills,
    activeBills: counts.billsActive,
    payments: counts.payments,
    movements: counts.movements,
    lastBackup: lastBackupTime() ? new Date(lastBackupTime()).toLocaleString("th-TH") : "ยังไม่เคย",
    generatedAt: new Date().toLocaleString("th-TH")
  };
}

function renderDiagnosticCards() {
  if (!$("diagnosticCards")) return;
  const d = diagnosticData();
  const cards = [
    ["เวอร์ชัน", d.version],
    ["สินค้า", d.products],
    ["ลูกค้า", d.customers],
    ["บิล", d.bills],
    ["สินค้าใกล้หมด", d.lowStock],
    ["Backup ล่าสุด", d.lastBackup],
    ["สถานะเน็ต", d.online],
    ["หน้าจอ", d.screen]
  ];
  $("diagnosticCards").innerHTML = cards.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function diagnosticText() {
  const d = diagnosticData();
  return [
    "Khaikhong Diagnostic",
    `Version: ${d.version}`,
    `URL: ${d.url}`,
    `Platform: ${d.platform}`,
    `Screen: ${d.screen}`,
    `Online: ${d.online}`,
    `DB: ${d.dbName}`,
    `Products: ${d.products}`,
    `Products with stock: ${d.productsWithStock}`,
    `Low stock: ${d.lowStock}`,
    `Customers: ${d.customers}`,
    `Bills: ${d.bills}`,
    `Active bills: ${d.activeBills}`,
    `Payments: ${d.payments}`,
    `Stock movements: ${d.movements}`,
    `Stock lots: ${d.stockLots}`,
    `Bill item lots: ${d.billItemLots}`,
    `Returns: ${d.returns}`,
    `Return items: ${d.returnItems}`,
    `Stock counts: ${d.stockCounts}`,
    `Stock count items: ${d.stockCountItems}`,
    `Close periods: ${d.closePeriods}`,
    `Activity logs: ${d.activityLogs}`,
    `Current lock date: ${d.currentLockDate}`,
    `PIN Lock: ${d.pinEnabled}`,
    `Last Backup: ${d.lastBackup}`,
    `Generated: ${d.generatedAt}`,
    `User Agent: ${d.userAgent}`
  ].join("\n");
}

function feedbackText() {
  return [
    "Khaikhong Feedback",
    `Version: ${appVersion()}`,
    `Page: ${$("feedbackPage")?.value || "-"}`,
    `Type: ${$("feedbackType")?.value || "-"}`,
    "",
    "รายละเอียด:",
    $("feedbackMessage")?.value || "-",
    "",
    "Diagnostic:",
    diagnosticText()
  ].join("\n");
}

async function copyTextToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    prompt(successMessage, text);
  }
}

function betaReportText() {
  const checklist = betaChecklist();
  return [
    "Khaikhong Beta Report",
    `Version: ${appVersion()}`,
    `Generated: ${new Date().toLocaleString("th-TH")}`,
    "",
    "Checklist:",
    ...checklist.map(item => `- ${item.title}: ${item.status.toUpperCase()} | ${item.detail}`),
    "",
    "Diagnostic:",
    diagnosticText()
  ].join("\n");
}


$("copyFeedbackBtn")?.addEventListener("click", () => copyTextToClipboard(feedbackText(), "คัดลอก Feedback แล้ว"));
$("copyDiagnosticBtn")?.addEventListener("click", () => copyTextToClipboard(diagnosticText(), "คัดลอกข้อมูลระบบแล้ว"));
$("copyBetaReportBtn")?.addEventListener("click", () => copyTextToClipboard(betaReportText(), "คัดลอกรายงาน Beta แล้ว"));
$("betaExportBackupBtn")?.addEventListener("click", () => $("exportBackupBtn")?.click());
["feedbackPage", "feedbackType", "feedbackMessage"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderDiagnosticCards);
});


["stockCountSearch", "stockCountCategoryFilter", "stockCountOnlyDiff"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderStockCountRows);
  if ($(id)) $(id).addEventListener("change", renderStockCountRows);
});
$("stockCountFillSystemBtn")?.addEventListener("click", fillStockCountWithSystem);
$("stockCountClearBtn")?.addEventListener("click", clearStockCountDraft);
$("stockCountApplyBtn")?.addEventListener("click", applyStockCount);


["closeLockUntil", "closePeriodType"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderClosePeriod);
  if ($(id)) $(id).addEventListener("change", renderClosePeriod);
});
$("closeTodayBtn")?.addEventListener("click", setClosePeriodToday);
$("closeMonthBtn")?.addEventListener("click", setClosePeriodMonth);
$("createClosePeriodBtn")?.addEventListener("click", createClosePeriod);
$("refreshClosePeriodBtn")?.addEventListener("click", async () => { await loadState(); switchTab("closePeriod"); showToast("รีเฟรชสถานะปิดรอบแล้ว"); });


["debtAgingSearch", "debtAgingCustomer", "debtAgingStatus", "debtDueFrom", "debtDueTo"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderDebtAging);
  if ($(id)) $(id).addEventListener("change", renderDebtAging);
});
$("debtShowAllBtn")?.addEventListener("click", () => setDebtAgingStatus(""));
$("debtOverdueBtn")?.addEventListener("click", () => setDebtAgingStatus("overdue"));
$("debtDueSoonBtn")?.addEventListener("click", () => setDebtAgingStatus("dueSoon"));
$("debtClearBtn")?.addEventListener("click", clearDebtAgingFilters);
$("copyDebtSummaryBtn")?.addEventListener("click", copyDebtSummary);
$("exportDebtAgingCsvBtn")?.addEventListener("click", exportDebtAgingCsv);


const moreMenuItems = [
  { group: "money", icon: "💵", title: "รับเงิน", hint: "รับชำระลูกหนี้", tab: "payments", keywords: "รับเงิน ลูกหนี้ ชำระ เครดิต" },
  { group: "money", icon: "📒", title: "ยอดค้าง", hint: "สมุดบัญชีลูกค้า", tab: "ledger", keywords: "ยอดค้าง ลูกหนี้ สมุดบัญชี เครดิต" },
  { group: "money", icon: "⏰", title: "ลูกหนี้ครบกำหนด", hint: "เกินกำหนด / ใกล้ครบ / แจ้งยอด", tab: "debtAging", keywords: "ลูกหนี้ ครบกำหนด เกินกำหนด แจ้งยอด เครดิต" },
  { group: "money report", icon: "📊", title: "รายงาน", hint: "ยอดขาย / กำไร", tab: "reports", keywords: "รายงาน ยอดขาย กำไร export" },
  { group: "money report", icon: "🔎", title: "ค้นหาบิล", hint: "วันที่ / ลูกค้า / เลขบิล / สินค้า", tab: "billSearch", keywords: "บิล ค้นหา เลขบิล ลูกค้า สินค้า" },

  { group: "stock", icon: "📦", title: "ซื้อเข้า", hint: "เพิ่มสต็อก / บันทึกต้นทุน", tab: "purchase", keywords: "ซื้อเข้า รับเข้า สต็อก ต้นทุน" },
  { group: "stock", icon: "⚠️", title: "สินค้าใกล้หมด", hint: "ดูรายการที่ควรซื้อเพิ่ม", tab: "lowStock", keywords: "ใกล้หมด สต็อกขั้นต่ำ ซื้อเพิ่ม" },
  { group: "stock", icon: "📋", title: "ตรวจนับสต็อก", hint: "นับจริง / เทียบระบบ", tab: "stockCount", keywords: "ตรวจนับ สต็อก นับจริง ปรับอัตโนมัติ" },
  { group: "stock", icon: "🧮", title: "ปรับสต็อก", hint: "ของเสีย / ของหาย / นับแล้วไม่ตรง", tab: "adjust", keywords: "ปรับสต็อก ของเสีย ของหาย ปรับเพิ่ม ปรับลด" },
  { group: "stock system", icon: "📦", title: "ตรวจ/ซ่อม FIFO", hint: "คำนวณล็อตต้นทุนใหม่", action: "repairFifo", keywords: "fifo ต้นทุน lot ล็อต ซ่อมทุน" },

  { group: "system", icon: "🔐", title: "ปิดรอบ / ล็อกย้อนหลัง", hint: "ล็อกบิล สต็อก และยอดย้อนหลัง", tab: "closePeriod", keywords: "ปิดรอบ ล็อกย้อนหลัง ปลดล็อก" },
  { group: "system", icon: "☁️", title: "Backup", hint: "สำรอง/กู้คืนข้อมูล", tab: "backup", keywords: "backup สำรอง restore กู้คืน import export" },
  { group: "system stock", icon: "📥", title: "Import Excel เดิม", hint: "นำเข้าข้อมูลจากไฟล์ .xlsx", tab: "backup", keywords: "excel xlsx import legacy นำเข้า ไฟล์เดิม" },
  { group: "system", icon: "👥", title: "ผู้ใช้งาน / สิทธิ์", hint: "บทบาท / จำกัดเมนู / ซ่อนกำไร", tab: "security", keywords: "user role permission สิทธิ์ ผู้ใช้งาน แคชเชียร์" },
  { group: "system report", icon: "🧾", title: "ประวัติการทำรายการ", hint: "ใครทำอะไร / Audit Trail", tab: "activityLog", keywords: "activity log audit ประวัติ ระบบ ใครทำอะไร" },
  { group: "system", icon: "🚀", title: "เริ่มต้นใช้งาน", hint: "Checklist / Feedback / Beta Ready", tab: "gettingStarted", keywords: "เริ่มต้น checklist feedback beta" },
  { group: "system", icon: "⚙️", title: "ตั้งค่า", hint: "ชื่อร้าน / เลขบิล / Number Pad", tab: "settings", keywords: "ตั้งค่า ชื่อร้าน เลขบิล number pad" },
  { group: "system", icon: "📘", title: "คู่มือ", hint: "วิธีใช้งานระบบ", tab: "guide", keywords: "คู่มือ วิธีใช้ help" },
  { group: "system", icon: "🛡️", title: "เกี่ยวกับแอป", hint: "Privacy / Local-first / เวอร์ชัน", tab: "about", keywords: "เกี่ยวกับ privacy local first version" },
  { group: "system", icon: "🧪", title: "ทดสอบระบบ", hint: "Auto Test / ตรวจสูตร / ล้างข้อมูล TEST", tab: "testCenter", keywords: "ทดสอบ test auto ล้างข้อมูล" }
];

function moreCategoryTitle(category) {
  if (category === "money") return "💰 ขาย / เงิน / ลูกหนี้";
  if (category === "stock") return "📦 สต็อก / ต้นทุน";
  if (category === "system") return "⚙️ ระบบ / ตั้งค่า / ความปลอดภัย";
  return "🗂️ เมนูทั้งหมด";
}

function renderMoreMenuCard(item) {
  const actionAttr = item.action
    ? `data-more-action="${item.action}" onclick="${item.action === 'repairFifo' ? 'repairAllCosts()' : ''}"`
    : `data-open-tab="${item.tab}" onclick="switchTab('${item.tab}')"`;
  return `
    <button class="more-card" ${actionAttr} type="button">
      <span>${item.icon}</span>
      <strong>${item.title}</strong>
      <small>${item.hint}</small>
    </button>
  `;
}

function bindMoreDynamicActions(root = document) {
  root.querySelectorAll("[data-more-action='repairFifo']").forEach(btn => {
    btn.addEventListener("click", repairAllCosts);
  });
}

function showMoreView(view) {
  ["moreHomeView", "moreSubmenuView", "moreSearchView"].forEach(id => $(id)?.classList.add("hidden-field"));
  $(view)?.classList.remove("hidden-field");
}

function openMoreCategory(category = "all") {
  const items = category === "all"
    ? moreMenuItems
    : moreMenuItems.filter(item => (item.group || "").split(/\s+/).includes(category));

  if ($("moreSubmenuTitle")) $("moreSubmenuTitle").textContent = moreCategoryTitle(category);
  if ($("moreSubmenuHint")) $("moreSubmenuHint").textContent = `มี ${items.length} เมนูในหมวดนี้`;
  if ($("moreSubmenuGrid")) {
    $("moreSubmenuGrid").innerHTML = items.map(renderMoreMenuCard).join("");
    bindMoreDynamicActions($("moreSubmenuGrid"));
  }
  showMoreView("moreSubmenuView");
}

function resetMoreMenu() {
  if ($("moreSearchInput")) $("moreSearchInput").value = "";
  showMoreView("moreHomeView");
}

function searchMoreMenu() {
  const q = ($("moreSearchInput")?.value || "").toLowerCase().trim();
  if (!q) {
    showMoreView("moreHomeView");
    return;
  }

  const rows = moreMenuItems.filter(item => `${item.title} ${item.hint} ${item.keywords || ""}`.toLowerCase().includes(q));
  if ($("moreSearchResultText")) $("moreSearchResultText").textContent = rows.length ? `พบ ${rows.length} เมนู` : "ไม่พบเมนูที่ค้นหา";
  if ($("moreSearchGrid")) {
    $("moreSearchGrid").innerHTML = rows.map(renderMoreMenuCard).join("") || `<div class="list-item empty-card"><div><div class="empty-emoji">🔎</div><strong>ไม่พบเมนู</strong><small>ลองค้นหาด้วยคำอื่น เช่น บิล, สต็อก, Backup</small></div></div>`;
    bindMoreDynamicActions($("moreSearchGrid"));
  }
  showMoreView("moreSearchView");
}

document.querySelectorAll(".more-category-card").forEach(card => {
  card.addEventListener("click", () => openMoreCategory(card.dataset.moreCategory || "all"));
});
$("moreBackBtn")?.addEventListener("click", resetMoreMenu);
$("moreHomeBtn")?.addEventListener("click", resetMoreMenu);
$("moreSearchBackBtn")?.addEventListener("click", resetMoreMenu);
$("moreSearchInput")?.addEventListener("input", searchMoreMenu);



async function hardResetPinAndCaches(reason = "manual") {
  try {
    sessionStorage.setItem("khaikhongPinUnlocked", "1");
    localStorage.setItem("khaikhongPinEmergencyResetAt", new Date().toISOString());
    localStorage.setItem("khaikhongPinEmergencyResetReason", reason);

    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    if (db) {
      await put("settings", {
        id: "pin",
        enabled: false,
        autoLock: "on",
        pinHash: "",
        emergencyResetAt: new Date().toISOString(),
        emergencyResetReason: reason,
        updatedAt: new Date().toISOString()
      });
      await loadState();
    }
  } catch (err) {
    console.error("hardResetPinAndCaches failed", err);
  }

  try { hidePinLock(); } catch {}
}


function isPrivacyMode() {
  return localStorage.getItem("khaikhongPrivacyMode") === "1";
}

function applyPrivacyMode() {
  document.body.classList.toggle("privacy-mode", isPrivacyMode());
  if ($("privacyModeBtn")) $("privacyModeBtn").textContent = isPrivacyMode() ? "ปิดโหมดซ่อนยอดเงิน" : "เปิดโหมดซ่อนยอดเงิน";
}

function togglePrivacyMode() {
  localStorage.setItem("khaikhongPrivacyMode", isPrivacyMode() ? "0" : "1");
  applyPrivacyMode();
  showToast(isPrivacyMode() ? "เปิดโหมดซ่อนยอดเงินแล้ว" : "ปิดโหมดซ่อนยอดเงินแล้ว");
}

function pinSettings() {
  return state.settings.find(s => s.id === "pin") || { id: "pin", enabled: false, autoLock: "on", pinHash: "" };
}

function isValidPinHash(hash) {
  return typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash);
}

function hasRealPinConfigured() {
  const p = pinSettings();
  return p.enabled === true && isValidPinHash(p.pinHash);
}

async function hashText(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function isPinEnabled() {
  // v2.3.12: ปิดระบบ PIN Lock ชั่วคราว เพื่อป้องกันการติดหน้าล็อก
  return false;
}

async function repairInvalidPinConfig() {
  const p = pinSettings();
  if (p.id === "pin" && (p.enabled === true || p.enabled === "true") && !isValidPinHash(p.pinHash)) {
    await put("settings", {
      ...p,
      enabled: false,
      autoLock: p.autoLock || "on",
      pinHash: "",
      repairedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await loadState();
    sessionStorage.setItem("khaikhongPinUnlocked", "1");
    hidePinLock();
    return true;
  }
  return false;
}

function renderPinSettings() {
  if (!$("pinStatusText")) return;
  $("pinStatusText").textContent = "PIN Lock ถูกพักใช้งานชั่วคราวในช่วง Beta เพื่อป้องกันการติดหน้าล็อก";
  $("pinStatusBadge").textContent = "พักใช้งาน";
  $("pinStatusBadge").classList.remove("enabled");
  if ($("pinAutoLock")) $("pinAutoLock").value = "off";
}

function showPinLock() {
  // v2.3.12: ไม่แสดงหน้า Lock อีก
  hidePinLock();
  return;
}

function hidePinLock() {
  $("pinLockOverlay")?.classList.add("hidden-field");
  if ($("pinUnlockInput")) $("pinUnlockInput").value = "";
  if ($("pinUnlockError")) $("pinUnlockError").textContent = "";
  sessionStorage.setItem("khaikhongPinUnlocked", "1");
}

async function savePinSettings() {
  alert("ตอนนี้ระบบ PIN Lock ถูกพักใช้งานชั่วคราวในช่วง Beta เพื่อป้องกันการติดหน้าล็อก\n\nแนะนำใช้ Backup และปิดรอบแทนก่อน เมื่อระบบนิ่งแล้วค่อยทำ PIN ใหม่แบบปลอดภัยกว่า");
  await forceResetPin("ปิด PIN Lock ชั่วคราวแล้ว");
}

async function disablePinSettings() {
  const p = pinSettings();
  if (!isPinEnabled()) {
    await forceResetPin("ยังไม่ได้เปิดใช้ PIN");
    return;
  }

  const typed = prompt("ปิดใช้ PIN Lock?\n\nกรุณาใส่ PIN ปัจจุบันเพื่อยืนยัน:");
  if (typed === null) return;
  if (await hashText(typed) !== p.pinHash) return alert("PIN ไม่ถูกต้อง");

  await forceResetPin("ปิดใช้ PIN Lock แล้ว");
}

async function unlockWithPin() {
  const p = pinSettings();

  if (!isPinEnabled()) {
    hidePinLock();
    return;
  }

  const typed = ($("pinUnlockInput")?.value || "").trim();
  if (!typed) {
    if ($("pinUnlockError")) $("pinUnlockError").textContent = "กรุณาใส่ PIN";
    return;
  }

  if (await hashText(typed) === p.pinHash) {
    hidePinLock();
  } else {
    if ($("pinUnlockError")) $("pinUnlockError").textContent = "PIN ไม่ถูกต้อง";
  }
}

async function forceResetPin(message = "Reset PIN แล้ว") {
  try {
    const p = pinSettings();
    await put("settings", {
      ...p,
      id: "pin",
      enabled: false,
      autoLock: p.autoLock || "on",
      pinHash: "",
      emergencyResetAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await loadState();
  } catch (err) {
    console.error("forceResetPin failed", err);
  }

  sessionStorage.setItem("khaikhongPinUnlocked", "1");
  hidePinLock();
  renderPinSettings();
  showToast(message);
}

async function emergencyResetPin() {
  const ok = confirm("ลืม PIN?\n\nระบบจะ Reset เฉพาะ PIN บนเครื่องนี้ ข้อมูลขาย/สินค้า/ลูกค้ายังอยู่เหมือนเดิม\n\nยืนยัน Reset PIN?");
  if (!ok) return;
  await forceResetPin("Reset PIN แล้ว");
}
window.forceResetKhaikhongPin = () => forceResetPin('Reset PIN ผ่าน Console แล้ว');

async function maybeAutoLockOnStart() {
  const url = new URL(location.href);
  const resetRequested =
    url.searchParams.get("resetPin") === "1" ||
    url.searchParams.get("resetPin") === "true" ||
    url.searchParams.get("resetpin") === "1" ||
    url.searchParams.get("pinOff") === "1" ||
    location.hash.toLowerCase().includes("resetpin");

  // v2.3.12: ไม่ล็อกแอปอีก และพยายามล้างค่า PIN เดิมทุกครั้งที่เริ่มแอป
  if (resetRequested) {
    await hardResetPinAndCaches("url-reset-or-pinOff");
    showToast("ปิด PIN และล้าง Cache แล้ว");
    url.searchParams.delete("resetPin");
    url.searchParams.delete("resetpin");
    url.searchParams.delete("pinOff");
    history.replaceState({}, "", url.pathname + url.search);
    return;
  }

  await silentDisablePinForBeta();
}


/* v2.3.15: Local Users & Permissions */
const ROLE_CONFIG = {
  owner: {
    name: "เจ้าของร้าน",
    badge: "เจ้าของร้าน",
    canSeeMoney: true,
    canSeeCost: true,
    allowedTabs: "all"
  },
  manager: {
    name: "ผู้จัดการ",
    badge: "ผู้จัดการ",
    canSeeMoney: true,
    canSeeCost: false,
    allowedTabs: ["sale","products","customers","summary","more","payments","ledger","debtAging","billSearch","reports","purchase","lowStock","stockCount","adjust","guide","about"]
  },
  cashier: {
    name: "แคชเชียร์",
    badge: "แคชเชียร์",
    canSeeMoney: true,
    canSeeCost: false,
    allowedTabs: ["sale","customers","summary","more","payments","ledger","debtAging","billSearch","guide","about"]
  },
  stock: {
    name: "สต็อก",
    badge: "สต็อก",
    canSeeMoney: false,
    canSeeCost: true,
    allowedTabs: ["products","summary","more","purchase","lowStock","stockCount","adjust","billSearch","guide","about"]
  }
};

function currentRole() {
  const role = localStorage.getItem("khaikhongCurrentRole") || "owner";
  return ROLE_CONFIG[role] ? role : "owner";
}

function roleConfig(role = currentRole()) {
  return ROLE_CONFIG[role] || ROLE_CONFIG.owner;
}

function canAccessTab(tabId) {
  const cfg = roleConfig();
  return cfg.allowedTabs === "all" || cfg.allowedTabs.includes(tabId);
}

function setCurrentRole(role) {
  if (!ROLE_CONFIG[role]) return;
  localStorage.setItem("khaikhongCurrentRole", role);
  applyRolePermissions();
  renderRoleSettings();
  showToast(`เปลี่ยนเป็นบทบาท ${ROLE_CONFIG[role].name} แล้ว`);
}

function resetRoleOwner() {
  setCurrentRole("owner");
}

function maskSensitiveForRole() {
  const cfg = roleConfig();
  document.body.classList.toggle("role-hide-cost", !cfg.canSeeCost);
  document.body.classList.toggle("role-hide-money", !cfg.canSeeMoney);
}

function applyRolePermissions() {
  const role = currentRole();
  const cfg = roleConfig(role);

  document.body.dataset.role = role;
  maskSensitiveForRole();

  document.querySelectorAll("[data-tab]").forEach(btn => {
    const tabId = btn.dataset.tab;
    if (!tabId) return;
    btn.classList.toggle("role-hidden", !canAccessTab(tabId));
  });

  document.querySelectorAll("[data-open-tab]").forEach(btn => {
    const tabId = btn.dataset.openTab;
    if (!tabId) return;
    btn.classList.toggle("role-hidden", !canAccessTab(tabId));
  });

  if ($("currentRoleText")) $("currentRoleText").textContent = `กำลังใช้งานในบทบาท: ${cfg.name}`;
  if ($("currentRoleBadge")) $("currentRoleBadge").textContent = cfg.badge;

  // ถ้าหน้าปัจจุบันไม่อนุญาต ให้เด้งไปหน้าที่เหมาะสม
  const activePage = document.querySelector(".page.active");
  if (activePage && !canAccessTab(activePage.id)) {
    if (canAccessTab("sale")) switchTab("sale");
    else if (canAccessTab("products")) switchTab("products");
    else switchTab("summary");
  }
}

function renderRoleSettings() {
  if (!$("currentRoleText")) return;
  const role = currentRole();
  const cfg = roleConfig(role);
  $("currentRoleText").textContent = `กำลังใช้งานในบทบาท: ${cfg.name}`;
  $("currentRoleBadge").textContent = cfg.badge;
  document.querySelectorAll(".role-card").forEach(card => {
    card.classList.toggle("active", card.dataset.role === role);
  });
}

function enforceRoleBeforeSwitch(tabId) {
  if (canAccessTab(tabId)) return true;
  alert(`บทบาท ${roleConfig().name} ไม่มีสิทธิ์เข้าเมนูนี้\n\nถ้าต้องการใช้งาน ให้เปลี่ยนบทบาทเป็นเจ้าของร้านหรือผู้จัดการ`);
  return false;
}

// ปิด Privacy Mode เดิม ไม่ให้ทำงานต่อ
function isPrivacyMode() { return false; }
function applyPrivacyMode() { document.body.classList.remove("privacy-mode"); }
function togglePrivacyMode() { alert("โหมดซ่อนยอดเงินถูกแทนที่ด้วยระบบผู้ใช้งาน/สิทธิ์แล้ว"); }


document.querySelectorAll(".role-card").forEach(card => {
  card.addEventListener("click", () => setCurrentRole(card.dataset.role || "owner"));
});
$("resetRoleBtn")?.addEventListener("click", resetRoleOwner);


/* v2.3.16: More Menu Dynamic Click Fix
   เมนูย่อยในหน้าเพิ่มเติมถูกสร้างด้วย JS ภายหลัง จึงต้องใช้ event delegation */
if (!window.__khaikhongMoreDelegatedClick) {
  window.__khaikhongMoreDelegatedClick = true;

  document.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-more-action]");
    if (actionBtn) {
      const action = actionBtn.dataset.moreAction;
      if (action === "repairFifo") {
        event.preventDefault();
        if (typeof repairAllCosts === "function") repairAllCosts();
      }
      return;
    }

    const tabBtn = event.target.closest("[data-open-tab]");
    if (!tabBtn) return;

    const tabId = tabBtn.dataset.openTab;
    if (!tabId) return;

    // ป้องกันปุ่มที่อยู่ใน dynamic more menu ไม่ตอบสนอง
    event.preventDefault();
    if (typeof switchTab === "function") {
      switchTab(tabId);
    }
  });
}


/* v2.3.17: Users & Permission Builder */
const PERMISSION_TEMPLATES = {
  owner:   { sale:true, customers:true, payments:true, reports:true, stock:true, system:true, cost:true },
  manager: { sale:true, customers:true, payments:true, reports:true, stock:true, system:false, cost:false },
  cashier: { sale:true, customers:true, payments:true, reports:false, stock:false, system:false, cost:false },
  stock:   { sale:false, customers:false, payments:false, reports:false, stock:true, system:false, cost:true }
};

const PERMISSION_LABELS = {
  sale: "ขาย",
  customers: "ลูกค้า",
  payments: "รับเงิน",
  reports: "รายงาน",
  stock: "สต็อก",
  system: "ระบบ",
  cost: "ต้นทุน/กำไร"
};

const TAB_PERMISSION_MAP = {
  sale: "sale",
  products: "stock",
  customers: "customers",
  summary: "reports",
  payments: "payments",
  ledger: "customers",
  debtAging: "payments",
  billSearch: "reports",
  reports: "reports",
  purchase: "stock",
  lowStock: "stock",
  stockCount: "stock",
  adjust: "stock",
  closePeriod: "system",
  backup: "system",
  settings: "system",
  gettingStarted: "system",
  testCenter: "system",
  guide: "system",
  about: "system",
  security: "always",
  activityLog: "system",
  more: "always",
  productDetail: "stock",
  customerDetail: "customers",
  billDetail: "reports"
};

function roleName(role) {
  return ROLE_CONFIG?.[role]?.name || ({ owner:"เจ้าของร้าน", manager:"ผู้จัดการ", cashier:"แคชเชียร์", stock:"สต็อก" }[role] || role);
}

function defaultLocalUsers() {
  return [{
    id: "owner",
    name: "เจ้าของร้าน",
    role: "owner",
    enabled: true,
    permissions: { ...PERMISSION_TEMPLATES.owner },
    protected: true,
    createdAt: new Date().toISOString()
  }];
}

function getLocalUsers() {
  try {
    const parsed = JSON.parse(localStorage.getItem("khaikhongLocalUsersV2") || "null");
    if (Array.isArray(parsed) && parsed.length) {
      const hasOwner = parsed.some(u => u.id === "owner");
      return hasOwner ? parsed : [...defaultLocalUsers(), ...parsed];
    }
  } catch {}
  return defaultLocalUsers();
}

function saveLocalUsers(users) {
  localStorage.setItem("khaikhongLocalUsersV2", JSON.stringify(users));
}

function ensureLocalUsers() {
  const users = getLocalUsers();
  saveLocalUsers(users);
  const activeId = localStorage.getItem("khaikhongActiveUserId");
  const activeOk = users.some(u => u.id === activeId && u.enabled !== false);
  if (!activeOk) localStorage.setItem("khaikhongActiveUserId", "owner");
  // เคลียร์ role เดิมที่เคยทำให้ติด manager
  if (!localStorage.getItem("khaikhongUsersMigrated2317")) {
    localStorage.setItem("khaikhongActiveUserId", "owner");
    localStorage.removeItem("khaikhongCurrentRole");
    localStorage.setItem("khaikhongUsersMigrated2317", "1");
  }
}

function activeUser() {
  ensureLocalUsers();
  const users = getLocalUsers();
  const id = localStorage.getItem("khaikhongActiveUserId") || "owner";
  return users.find(u => u.id === id && u.enabled !== false) || users.find(u => u.id === "owner") || defaultLocalUsers()[0];
}

function currentRole() {
  return activeUser().role || "owner";
}

function roleConfig(role = currentRole()) {
  const u = activeUser();
  return {
    ...(ROLE_CONFIG?.[role] || ROLE_CONFIG.owner),
    name: u.name || roleName(role),
    badge: roleName(role),
    canSeeCost: !!u.permissions?.cost,
    canSeeMoney: !!(u.permissions?.sale || u.permissions?.payments || u.permissions?.reports || u.permissions?.customers)
  };
}

function canAccessTab(tabId) {
  const perm = TAB_PERMISSION_MAP[tabId] || "system";
  if (perm === "always") return true;
  const u = activeUser();
  return !!u.permissions?.[perm];
}

function setActiveUser(id) {
  const users = getLocalUsers();
  const u = users.find(x => x.id === id && x.enabled !== false);
  if (!u) return alert("ผู้ใช้นี้ถูกปิดใช้งานหรือไม่พบข้อมูล");
  localStorage.setItem("khaikhongActiveUserId", id);
  logActivity("USER_SWITCH", `สลับผู้ใช้เป็น ${u.name}`, { refType: "user", refId: id, detail: roleName(u.role) });
  applyRolePermissions();
  renderRoleSettings();
  showToast(`เปลี่ยนผู้ใช้งานเป็น ${u.name}`);
}

function setCurrentRole(role) {
  // เก็บไว้เพื่อ compatibility: เปลี่ยนเป็น owner เท่านั้นถ้ากดจากระบบเก่า
  if (role === "owner") setActiveUser("owner");
}

function resetRoleOwner() {
  setActiveUser("owner");
}

function resetLocalUserForm() {
  if ($("localUserId")) $("localUserId").value = "";
  if ($("localUserName")) $("localUserName").value = "";
  if ($("localUserRole")) $("localUserRole").value = "cashier";
  if ($("localUserEnabled")) $("localUserEnabled").value = "true";
  setPermissionCheckboxes(PERMISSION_TEMPLATES.cashier);
}

function setPermissionCheckboxes(perms) {
  document.querySelectorAll("[data-perm]").forEach(cb => {
    cb.checked = !!perms[cb.dataset.perm];
  });
}

function getPermissionCheckboxes() {
  const out = {};
  document.querySelectorAll("[data-perm]").forEach(cb => {
    out[cb.dataset.perm] = !!cb.checked;
  });
  return out;
}

function applyRoleTemplateToForm() {
  const role = $("localUserRole")?.value || "cashier";
  setPermissionCheckboxes(PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.cashier);
}

function editLocalUser(id) {
  const u = getLocalUsers().find(x => x.id === id);
  if (!u) return;
  $("localUserId").value = u.id;
  $("localUserName").value = u.name || "";
  $("localUserRole").value = u.role || "cashier";
  $("localUserEnabled").value = String(u.enabled !== false);
  setPermissionCheckboxes(u.permissions || PERMISSION_TEMPLATES[u.role] || {});
  switchTab("security");
}

function saveLocalUserFromForm() {
  const users = getLocalUsers();
  const id = $("localUserId")?.value || `u-${Date.now()}`;
  const old = users.find(u => u.id === id);
  const name = ($("localUserName")?.value || "").trim();
  const role = $("localUserRole")?.value || "cashier";
  const enabled = $("localUserEnabled")?.value !== "false";
  const permissions = getPermissionCheckboxes();

  if (!name) return alert("กรุณาใส่ชื่อผู้ใช้งาน");

  const user = {
    ...(old || {}),
    id,
    name,
    role,
    enabled: id === "owner" ? true : enabled,
    permissions: id === "owner" ? { ...PERMISSION_TEMPLATES.owner } : permissions,
    protected: id === "owner",
    updatedAt: new Date().toISOString(),
    createdAt: old?.createdAt || new Date().toISOString()
  };

  const next = old ? users.map(u => u.id === id ? user : u) : [...users, user];
  saveLocalUsers(next);
  logActivity("USER_SAVE", `${old ? "แก้ไข" : "สร้าง"}ผู้ใช้ ${name}`, { refType: "user", refId: id, detail: `${roleName(role)} • สิทธิ์ ${Object.keys(permissions).filter(k => permissions[k]).join(", ")}` });
  renderRoleSettings();
  resetLocalUserForm();
  showToast("บันทึกผู้ใช้งานแล้ว");
}

function deleteLocalUserFromForm() {
  const id = $("localUserId")?.value;
  if (!id) return alert("กรุณาเลือกผู้ใช้งานที่ต้องการลบ");
  if (id === "owner") return alert("ลบเจ้าของร้านไม่ได้");
  const users = getLocalUsers();
  const u = users.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`ลบผู้ใช้งาน ${u.name}?`)) return;
  saveLocalUsers(users.filter(x => x.id !== id));
  logActivity("USER_DELETE", `ลบผู้ใช้ ${u.name}`, { refType: "user", refId: id, detail: roleName(u.role) });
  if (localStorage.getItem("khaikhongActiveUserId") === id) localStorage.setItem("khaikhongActiveUserId", "owner");
  resetLocalUserForm();
  renderRoleSettings();
  applyRolePermissions();
  showToast("ลบผู้ใช้งานแล้ว");
}

function resetAllLocalUsers() {
  if (!confirm("รีเซ็ตผู้ใช้งานทั้งหมดกลับเป็นเจ้าของร้านคนเดียว?")) return;
  saveLocalUsers(defaultLocalUsers());
  logActivity("USER_RESET", "รีเซ็ตผู้ใช้งาน", { detail: "กลับเป็นเจ้าของร้านคนเดียว" });
  localStorage.setItem("khaikhongActiveUserId", "owner");
  localStorage.removeItem("khaikhongCurrentRole");
  resetLocalUserForm();
  renderRoleSettings();
  applyRolePermissions();
  showToast("รีเซ็ตผู้ใช้งานแล้ว");
}

function renderLocalUsersList() {
  const list = $("localUsersList");
  if (!list) return;
  const activeId = localStorage.getItem("khaikhongActiveUserId") || "owner";
  const users = getLocalUsers();

  list.innerHTML = users.map(u => {
    const perms = Object.keys(PERMISSION_LABELS).map(k => {
      const ok = !!u.permissions?.[k];
      return `<span class="user-perm-chip ${ok ? "" : "no"}">${ok ? "✓" : "×"} ${PERMISSION_LABELS[k]}</span>`;
    }).join("");

    return `
      <div class="list-item ${u.id === "owner" ? "user-row-owner" : ""} ${u.enabled === false ? "user-row-disabled" : ""}">
        <div>
          <strong>${u.name} ${u.id === activeId ? "• กำลังใช้งาน" : ""}</strong>
          <small>${roleName(u.role)} • ${u.enabled === false ? "ปิดใช้งาน" : "เปิดใช้งาน"}</small>
          <div>${perms}</div>
        </div>
        <div class="row-actions">
          <button class="small-btn" onclick="setActiveUser('${u.id}')">ใช้งาน</button>
          <button class="small-btn small-edit" onclick="editLocalUser('${u.id}')">แก้ไข</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderRoleSettings() {
  ensureLocalUsers();
  const user = activeUser();
  if ($("currentRoleText")) $("currentRoleText").textContent = `กำลังใช้งาน: ${user.name} • ${roleName(user.role)}`;
  if ($("currentRoleBadge")) $("currentRoleBadge").textContent = roleName(user.role);
  if ($("activeUserRoleText")) $("activeUserRoleText").value = roleName(user.role);
  if ($("activeUserStatusText")) $("activeUserStatusText").value = user.enabled === false ? "ปิดใช้งาน" : "เปิดใช้งาน";

  const sel = $("activeUserSelect");
  if (sel) {
    const users = getLocalUsers().filter(u => u.enabled !== false);
    sel.innerHTML = users.map(u => `<option value="${u.id}">${u.name} • ${roleName(u.role)}</option>`).join("");
    sel.value = user.id;
  }

  renderLocalUsersList();
  document.querySelectorAll(".role-card").forEach(card => {
    card.classList.toggle("active", card.dataset.role === user.role);
  });
}

function applyRolePermissions() {
  ensureLocalUsers();
  const user = activeUser();
  const perms = user.permissions || {};
  document.body.dataset.role = user.role || "owner";
  document.body.dataset.roleLabel = roleName(user.role);
  document.body.classList.toggle("role-hide-cost", !perms.cost);
  document.body.classList.toggle("role-hide-money", !(perms.sale || perms.payments || perms.reports || perms.customers));

  document.querySelectorAll("[data-tab]").forEach(btn => {
    const tabId = btn.dataset.tab;
    if (!tabId) return;
    btn.classList.toggle("role-hidden", !canAccessTab(tabId));
  });

  document.querySelectorAll("[data-open-tab]").forEach(btn => {
    const tabId = btn.dataset.openTab;
    if (!tabId) return;
    btn.classList.toggle("role-hidden", !canAccessTab(tabId));
  });

  renderRoleSettings();
}

function enforceRoleBeforeSwitch(tabId) {
  if (canAccessTab(tabId)) return true;
  alert(`ผู้ใช้งาน ${activeUser().name} ไม่มีสิทธิ์เข้าเมนูนี้\n\nถ้าต้องการใช้งาน ให้เปลี่ยนเป็นเจ้าของร้านในหน้า ผู้ใช้งาน / สิทธิ์`);
  return false;
}

window.editLocalUser = editLocalUser;
window.setActiveUser = setActiveUser;


$("activeUserSelect")?.addEventListener("change", e => setActiveUser(e.target.value));
$("quickOwnerBtn")?.addEventListener("click", () => setActiveUser("owner"));
$("resetUsersBtn")?.addEventListener("click", resetAllLocalUsers);
$("newUserBtn")?.addEventListener("click", resetLocalUserForm);
$("saveLocalUserBtn")?.addEventListener("click", saveLocalUserFromForm);
$("deleteLocalUserBtn")?.addEventListener("click", deleteLocalUserFromForm);
$("applyRoleTemplateBtn")?.addEventListener("click", applyRoleTemplateToForm);
$("localUserRole")?.addEventListener("change", applyRoleTemplateToForm);


["activitySearch", "activityUserFilter", "activityActionFilter", "activityFrom", "activityTo"].forEach(id => {
  if ($(id)) $(id).addEventListener("input", renderActivityLog);
  if ($(id)) $(id).addEventListener("change", renderActivityLog);
});
$("activityTodayBtn")?.addEventListener("click", () => setActivityRange("today"));
$("activity7DaysBtn")?.addEventListener("click", () => setActivityRange("7days"));
$("activityClearBtn")?.addEventListener("click", clearActivityFilters);
$("exportActivityLogCsvBtn")?.addEventListener("click", exportActivityLogCsv);
$("copyActivitySummaryBtn")?.addEventListener("click", copyActivitySummary);
$("clearTestActivityLogsBtn")?.addEventListener("click", clearTestActivityLogs);


$("legacyExcelInput")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) await previewLegacyExcelFile(file);
});
$("confirmLegacyExcelImportBtn")?.addEventListener("click", importLegacyExcelData);

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


window.addEventListener("load", () => {
  setTimeout(async () => {
    try {
      if (typeof maybeAutoLockOnStart === "function") {
        await maybeAutoLockOnStart();
  resetLocalUserForm();
  applyRolePermissions();
      }
    } catch (err) {
      console.error("khaikhongPinBootSafety failed", err);
    }
  }, 250);
});



async function silentDisablePinForBeta() {
  try {
    const p = typeof pinSettings === "function" ? pinSettings() : { id: "pin" };
    if (typeof put === "function") {
      await put("settings", {
        ...p,
        id: "pin",
        enabled: false,
        autoLock: "off",
        pinHash: "",
        disabledForBetaAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    sessionStorage.setItem("khaikhongPinUnlocked", "1");
    localStorage.setItem("khaikhongPinRemoved", "1");
  } catch (err) {
    console.error("silentDisablePinForBeta failed", err);
  }
  try { khaikhongRemovePinOverlay(); } catch {}
}

/* v2.3.13 HARD PIN REMOVAL
   ระบบ PIN Lock ถูกถอดออกจาก runtime เพื่อป้องกันการติดหน้าล็อกในช่วง Beta */
const KHAIKHONG_PIN_REMOVED = true;

function khaikhongRemovePinOverlay() {
  try {
    sessionStorage.setItem("khaikhongPinUnlocked", "1");
    localStorage.setItem("khaikhongPinEmergencyResetAt", new Date().toISOString());
    localStorage.setItem("khaikhongPinEmergencyResetReason", "v2.3.13 hard remove");
    document.querySelectorAll("#pinLockOverlay,.pin-lock-overlay").forEach(el => el.remove());
    document.body.classList.remove("pin-locked");
  } catch (err) {
    console.error("khaikhongRemovePinOverlay failed", err);
  }
}

// Override PIN functions no matter what was defined earlier
isPinEnabled = function() { return false; };
showPinLock = function() { khaikhongRemovePinOverlay(); };
hidePinLock = function() { khaikhongRemovePinOverlay(); };
maybeAutoLockOnStart = async function() {
  await silentDisablePinForBeta();
};
unlockWithPin = async function() { khaikhongRemovePinOverlay(); };
emergencyResetPin = async function() {
  await forceResetPin("Reset PIN แล้ว");
  khaikhongRemovePinOverlay();
};
window.forceResetKhaikhongPin = async function() {
  await forceResetPin("Reset PIN ผ่าน Console แล้ว");
  khaikhongRemovePinOverlay();
};

window.addEventListener("DOMContentLoaded", khaikhongRemovePinOverlay);
window.addEventListener("load", () => setTimeout(khaikhongRemovePinOverlay, 50));
setInterval(khaikhongRemovePinOverlay, 1000);

if ("serviceWorker" in navigator) {
  // v2.3.13: พักการ register service worker ชั่วคราวเพื่อแก้ cache lock
  navigator.serviceWorker.getRegistrations?.().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
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
  await maybeAutoLockOnStart();
})();
