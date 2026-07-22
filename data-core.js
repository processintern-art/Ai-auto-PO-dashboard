/* ============================================================
   PO Dashboard — Data Core
   Column mapping, item aggregation, KPI computation, chart data
   shaping, and AI insights generation. Pure functions, no DOM.
   ============================================================ */

/* ============================================================
   PO Dashboard — Data Core
   Column mapping, item aggregation, KPI computation, chart data
   shaping, and AI insights generation. Pure functions, no DOM.

   Canonical field set covers two PO formats:
   1. The original flat-row schema (PO Number, Vendor Name, Item
      Description, Gross Amount, etc.)
   2. The "PO Tracker" schema seen in real exports, e.g.:
      Sl. No, P.O. No, P.O. Date, PO Raised By, Vendor Name,
      Vendor Address, Vendor Email, GSTN, Description of Item,
      Dimension, Qty, UOM (sqft / Inch), Unit Rate (Rs.),
      Total Value, Tax Rate, Total Tax, Gross Amount (Rs.),
      Net Total, Remarks, Month, Year

   Total Value, Gross Amount, and Net Total are kept as three
   DISTINCT canonical fields (not merged into one "amount" field)
   because real files can carry all three simultaneously with
   different meanings: Total Value = pre-tax line subtotal,
   Gross Amount = pre-net PO total, Net Total = final PO total
   after tax. Collapsing them under one synonym list would make
   one column win the mapping and silently drop the other two.
   ============================================================ */

const CANONICAL_FIELDS = {
  slNo: { label: 'Sl. No', synonyms: ['sl no','serial no','serial number','s no','sno','sl number','item no','row no'], type: 'number' },
  poNumber: { label: 'PO Number', synonyms: ['po number','po no','po#','pono','purchase order number','purchase order no','order number','order no','po id','poid','order id','po ref','reference number','document number','doc no','po num'], type: 'id' },
  poDate: { label: 'PO Date', synonyms: ['po date','order date','purchase date','date','created date','doc date','document date','transaction date','issue date','invoice date'], type: 'date' },
  poRaisedBy: { label: 'PO Raised By', synonyms: ['po raised by','raised by','requested by','prepared by','created by','ordered by','requisitioned by'], type: 'text' },
  vendorName: { label: 'Vendor Name', synonyms: ['vendor name','vendor','supplier name','supplier','party name','party','seller','seller name','company name','vendor/supplier','beneficiary'], type: 'text' },
  vendorAddress: { label: 'Vendor Address', synonyms: ['vendor address','supplier address','party address','address'], type: 'text' },
  vendorEmail: { label: 'Vendor Email', synonyms: ['vendor email','supplier email','email','email id','email address','contact email'], type: 'text' },
  gstn: { label: 'GSTN', synonyms: ['gstn','gst no','gst number','gstin','tax registration number','vendor gst'], type: 'text' },
  itemDescription: { label: 'Item Description', synonyms: ['item description','item name','item','description','description of item','product name','product','particulars','material description','material','goods description','item details','sku description'], type: 'text' },
  dimension: { label: 'Dimension', synonyms: ['dimension','dimensions','size','measurement','specs','specification'], type: 'text' },
  quantity: { label: 'Quantity', synonyms: ['quantity','qty','qty.','no of units','units','order qty','ordered qty','order quantity'], type: 'number' },
  unit: { label: 'Unit', synonyms: ['unit','uom','unit of measure','units','measure','unit type','uom sqft inch','uom sqft / inch'], type: 'text' },
  unitRate: { label: 'Unit Rate', synonyms: ['unit rate','rate','unit price','price','price per unit','rate per unit','cost per unit','unit cost','price/unit','unit rate rs'], type: 'number' },
  discount: { label: 'Discount', synonyms: ['discount','disc','discount amount','discount %','discount percent','disc amount','rebate'], type: 'number' },
  deliveryCharge: { label: 'Delivery Charge', synonyms: ['delivery charge','delivery','freight','freight charge','shipping','shipping charge','transport charge','transportation','courier charge'], type: 'number' },
  totalValue: { label: 'Total Value', synonyms: ['total value','line value','line total','item value','item total','subtotal','sub total'], type: 'number' },
  taxRate: { label: 'Tax Rate', synonyms: ['tax rate','gst rate','gst %','vat rate','tax %','tax percent','gst percent'], type: 'number' },
  taxAmount: { label: 'Total Tax', synonyms: ['tax amount','gst amount','tax value','vat amount','total tax','cgst','sgst','igst'], type: 'number' },
  grossAmount: { label: 'Gross Amount', synonyms: ['gross amount','gross amount rs','grand total','po value','po amount','invoice value','invoice amount','final amount','total cost'], type: 'number' },
  netTotal: { label: 'Net Total', synonyms: ['net total','net amount','total amount','amount','total','grand net total','payable amount'], type: 'number' },
  remarks: { label: 'Remarks', synonyms: ['remarks','remark','notes','note','comments','comment'], type: 'text' },
  month: { label: 'Month', synonyms: ['month','po month'], type: 'text' },
  financialYear: { label: 'Financial Year', synonyms: ['financial year','fy','fiscal year','f.y.','fy year','year'], type: 'text' },
  category: { label: 'Category', synonyms: ['category','item category','product category','class','classification','group','item group','material group','segment'], type: 'text' }
};

function normalizeHeader(str) {
  let s = String(str || '').toLowerCase();
  // Collapse dotted initialisms ("P.O." / "F.Y." / "S.No.") into a single run
  // of letters BEFORE punctuation becomes a space — otherwise "P.O. No"
  // normalizes to "p o no" instead of "po no" and fails every synonym match.
  s = s.replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, ''));
  s = s.replace(/[_\-./\\]/g, ' ').replace(/[^\w\s%#]/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  }
  return dp[m][n];
}
function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
function sniffType(values) {
  const sample = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 30);
  if (sample.length === 0) return 'unknown';
  let numCount = 0, dateCount = 0, textCount = 0;
  for (const v of sample) {
    if (typeof v === 'number' && isFinite(v)) { numCount++; continue; }
    const s = String(v).trim();
    if (/^-?[\d,]+\.?\d*%?$/.test(s.replace(/[₹$€,\s]/g, ''))) { numCount++; continue; }
    if (!isNaN(Date.parse(s)) && (/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(s) || /\d{1,2}[-\s][a-z]{3,9}[-\s]\d{2,4}/i.test(s))) { dateCount++; continue; }
    textCount++;
  }
  const total = sample.length;
  if (dateCount / total > 0.6) return 'date';
  if (numCount / total > 0.6) return 'number';
  return 'text';
}

function isJunkHeader(rawHeader) {
  const s = String(rawHeader || '').trim();
  if (!s) return true;
  // pandas/Excel export artifacts for blank trailing columns, e.g. "Unnamed: 23"
  if (/^unnamed:?\s*\d*$/i.test(s)) return true;
  return false;
}

function mapColumns(headers, sampleRows) {
  const normalizedHeaders = headers.map(h => isJunkHeader(h) ? '' : normalizeHeader(h));
  const columnValues = headers.map((_, colIdx) => sampleRows.map(row => row[colIdx]));
  const columnTypes = columnValues.map(sniffType);
  const mappingIdx = {}, mapping = {}, confidence = {};
  const candidates = [];
  for (const [field, def] of Object.entries(CANONICAL_FIELDS)) {
    headers.forEach((header, colIdx) => {
      const normHeader = normalizedHeaders[colIdx];
      if (!normHeader) return;
      let bestSyn = 0;
      for (const syn of def.synonyms) {
        if (normHeader === syn) { bestSyn = Math.max(bestSyn, 1); continue; }
        if (normHeader.includes(syn) || syn.includes(normHeader)) {
          const lenRatio = Math.min(normHeader.length, syn.length) / Math.max(normHeader.length, syn.length);
          bestSyn = Math.max(bestSyn, 0.75 + 0.2 * lenRatio);
          continue;
        }
        const sim = similarity(normHeader, syn);
        if (sim > 0.6) bestSyn = Math.max(bestSyn, sim * 0.85);
      }
      if (bestSyn === 0) return;
      let typeAdj = 0;
      const colType = columnTypes[colIdx];
      if (def.type === colType) typeAdj = 0.08;
      else if (def.type === 'number' && colType === 'text') typeAdj = -0.25;
      else if (def.type === 'date' && colType !== 'date') typeAdj = -0.3;
      else if (def.type === 'text' && colType === 'number') typeAdj = -0.15;
      const score = Math.max(0, Math.min(1, bestSyn + typeAdj));
      candidates.push({ field, colIdx, header, score });
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedFields = new Set(), usedCols = new Set();
  for (const c of candidates) {
    if (usedFields.has(c.field) || usedCols.has(c.colIdx)) continue;
    if (c.score < 0.45) continue;
    mapping[c.field] = c.header;
    mappingIdx[c.field] = c.colIdx;
    confidence[c.field] = Math.round(c.score * 100) / 100;
    usedFields.add(c.field);
    usedCols.add(c.colIdx);
  }
  const unmapped = headers.filter((h, idx) => !usedCols.has(idx) && !isJunkHeader(h));
  return { mapping, mappingIdx, confidence, unmapped, columnTypes, junkColumns: headers.filter(isJunkHeader) };
}

/* ---------- Item aggregation ---------- */
function normalizeItemKey(desc) {
  return String(desc || '').toLowerCase().trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s+(?=[a-z])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function isLineItemRow(row) {
  // A genuine line item has its own quantity+rate, or at minimum a line subtotal.
  // Rows that carry only PO-level totals (Net Total / Gross Amount / Total Tax)
  // with no quantity, no unit rate, and no line subtotal are PO-summary rows —
  // common in "header row + line items" PO Tracker exports — and must not be
  // treated as a purchased item in their own right, even if their Description
  // of Item field happens to contain text (e.g. a stray tax/SAC code label).
  const hasQtyAndRate = (Number(row.quantity) || 0) > 0 && (Number(row.unitRate) || 0) > 0;
  const hasLineValue = (Number(row.totalValue) || 0) > 0;
  return hasQtyAndRate || hasLineValue;
}

/**
 * Attaches AI-style price root-cause analysis to every duplicate item in
 * an item-analysis array, in place. Looks up the analysis engine from
 * whichever global scope is active (browser window, Web Worker self, or a
 * Node require for testing) rather than hard-importing it, so data-core.js
 * keeps working standalone (e.g. in tests) even when price-analysis.js
 * isn't loaded alongside it — duplicate items just won't get the extra
 * `priceAnalysis` field in that case, everything else is unaffected.
 */
function attachPriceAnalysis(itemAnalysis) {
  let engine = null;
  if (typeof window !== 'undefined' && window.POPriceAnalysis) engine = window.POPriceAnalysis;
  else if (typeof self !== 'undefined' && self.POPriceAnalysis) engine = self.POPriceAnalysis;
  else if (typeof global !== 'undefined' && global.__POPriceAnalysisForTests) engine = global.__POPriceAnalysisForTests;
  if (!engine) return;

  for (const item of itemAnalysis) {
    if (item.isDuplicate) {
      item.priceAnalysis = engine.analyzeItemPriceHistory(item.records);
    }
  }
}

function aggregateItems(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!isLineItemRow(row)) continue;
    const key = normalizeItemKey(row.itemDescription);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { itemDescription: row.itemDescription, records: [] });
    groups.get(key).records.push(row);
  }
  const results = [];
  for (const [key, group] of groups.entries()) {
    const records = group.records.slice().sort((a, b) => {
      const da = a.poDate ? new Date(a.poDate).getTime() : 0;
      const db = b.poDate ? new Date(b.poDate).getTime() : 0;
      return da - db;
    });
    const rates = records.map(r => Number(r.unitRate) || 0).filter(r => r > 0);
    const totalQuantity = records.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const totalPurchaseValue = records.reduce((s, r) => s + (Number(r.effectiveLineValue != null ? r.effectiveLineValue : r.grossAmount) || 0), 0);
    const avgUnitRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    const latestUnitRate = rates.length ? Number(records[records.length - 1].unitRate) || 0 : 0;
    const earliestUnitRate = rates.length ? Number(records[0].unitRate) || 0 : 0;
    const minRate = rates.length ? Math.min(...rates) : 0;
    const maxRate = rates.length ? Math.max(...rates) : 0;
    const priceDifference = maxRate - minRate;
    const priceChangePct = earliestUnitRate > 0 ? ((latestUnitRate - earliestUnitRate) / earliestUnitRate) * 100 : 0;
    const vendors = new Set(records.map(r => r.vendorName).filter(Boolean));
    const poNumbers = new Set(records.map(r => r.poNumber).filter(Boolean));
    const categories = new Set(records.map(r => r.category).filter(Boolean));
    results.push({
      itemKey: key, itemDescription: group.itemDescription, purchaseFrequency: records.length,
      totalQuantity, avgUnitRate: round2(avgUnitRate), latestUnitRate: round2(latestUnitRate),
      earliestUnitRate: round2(earliestUnitRate), minRate: round2(minRate), maxRate: round2(maxRate),
      priceDifference: round2(priceDifference), priceChangePct: round2(priceChangePct),
      totalPurchaseValue: round2(totalPurchaseValue), vendorCount: vendors.size, vendors: Array.from(vendors),
      poCount: poNumbers.size, category: Array.from(categories)[0] || 'Uncategorized',
      isDuplicate: records.length > 1, trend: priceChangePct > 2 ? 'increasing' : priceChangePct < -2 ? 'decreasing' : 'stable',
      records
    });
  }
  return results.sort((a, b) => b.totalPurchaseValue - a.totalPurchaseValue);
}

/* ---------- Insights ---------- */
function fmtMoney(n, currency) {
  const sym = currency || '₹';
  return sym + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function generateInsights({ rows, itemAnalysis, vendorTotals, monthlyTrend, currency, totalPurchaseValue }) {
  const insights = [];
  if (!rows.length) return insights;
  const M = (n) => fmtMoney(n, currency);

  const vendorEntries = Object.entries(vendorTotals).sort((a, b) => b[1].total - a[1].total);
  // Use the already-correctly-rolled-up PO-level total when supplied (this avoids
  // double counting / under counting when a PO's financial total lives on only
  // one of several rows for that PO, e.g. a "header row + line items" layout).
  // Fall back to summing grossAmount directly only for callers that don't pass it
  // (keeps this function usable in isolation, e.g. in tests).
  const totalGross = totalPurchaseValue != null ? totalPurchaseValue : rows.reduce((s, r) => s + (Number(r.grossAmount) || 0), 0);

  if (vendorEntries.length) {
    const [topVendor, data] = vendorEntries[0];
    const share = totalGross > 0 ? (data.total / totalGross) * 100 : 0;
    insights.push({ type: 'highest-vendor', icon: 'trophy', title: 'Highest Spending Vendor',
      text: `${topVendor} accounts for ${M(data.total)} (${share.toFixed(1)}% of total spend) across ${data.poCount} purchase orders.` });
  }
  if (itemAnalysis.length) {
    const mostFrequent = itemAnalysis.slice().sort((a, b) => b.purchaseFrequency - a.purchaseFrequency)[0];
    insights.push({ type: 'most-purchased', icon: 'repeat', title: 'Most Frequently Purchased Item',
      text: `"${mostFrequent.itemDescription}" was purchased ${mostFrequent.purchaseFrequency} times, totaling ${mostFrequent.totalQuantity.toLocaleString('en-IN')} units worth ${M(mostFrequent.totalPurchaseValue)}.` });
  }
  const risingItems = itemAnalysis.filter(i => i.trend === 'increasing' && i.purchaseFrequency > 1).sort((a, b) => b.priceChangePct - a.priceChangePct);
  if (risingItems.length) {
    const top = risingItems[0];
    insights.push({ type: 'price-increase', icon: 'trending-up', title: 'Items With Rising Prices',
      text: `${risingItems.length} item(s) show rising unit rates. "${top.itemDescription}" rose ${top.priceChangePct.toFixed(1)}% from ${M(top.earliestUnitRate)} to ${M(top.latestUnitRate)} per unit.` });
  }
  const multiVendorItems = itemAnalysis.filter(i => i.vendorCount > 1 && i.priceDifference > 0)
    .sort((a, b) => (b.priceDifference * b.totalQuantity) - (a.priceDifference * a.totalQuantity));
  if (multiVendorItems.length) {
    const top = multiVendorItems[0];
    const potentialSaving = top.priceDifference * top.totalQuantity;
    insights.push({ type: 'cost-saving', icon: 'piggy-bank', title: 'Cost Saving Opportunity',
      text: `"${top.itemDescription}" was bought from ${top.vendorCount} vendors at rates ranging from ${M(top.minRate)} to ${M(top.maxRate)}. Standardizing to the lowest rate could have saved up to ${M(potentialSaving)}.` });
  }
  const duplicates = itemAnalysis.filter(i => i.isDuplicate);
  if (duplicates.length) {
    insights.push({ type: 'duplicates', icon: 'copy', title: 'Duplicate Purchases Detected',
      text: `${duplicates.length} item(s) were purchased more than once across different POs, representing ${M(duplicates.reduce((s, i) => s + i.totalPurchaseValue, 0))} in combined spend.` });
  }
  if (multiVendorItems.length > 1) {
    const top = multiVendorItems[0];
    insights.push({ type: 'vendor-comparison', icon: 'scale', title: 'Vendor Price Comparison',
      text: `Across items purchased from multiple vendors, price gaps as high as ${M(top.priceDifference)} per unit were found on "${top.itemDescription}" — worth reviewing vendor contracts.` });
  }
  if (monthlyTrend && monthlyTrend.length >= 2) {
    const last = monthlyTrend[monthlyTrend.length - 1];
    const prev = monthlyTrend[monthlyTrend.length - 2];
    const change = prev.total > 0 ? ((last.total - prev.total) / prev.total) * 100 : 0;
    const direction = change >= 0 ? 'increased' : 'decreased';
    insights.push({ type: 'trend', icon: 'activity', title: 'Recent Purchase Trend',
      text: `Purchase value ${direction} by ${Math.abs(change).toFixed(1)}% in ${last.label} compared to ${prev.label} (${M(last.total)} vs ${M(prev.total)}).` });
  }
  const totalTax = rows.reduce((s, r) => s + (Number(r.taxAmount) || 0), 0);
  if (totalTax > 0) {
    const taxShare = totalGross > 0 ? (totalTax / totalGross) * 100 : 0;
    insights.push({ type: 'tax-summary', icon: 'receipt', title: 'Tax Summary',
      text: `Total tax paid across all purchases is ${M(totalTax)}, representing ${taxShare.toFixed(1)}% of total purchase value.` });
  }
  const singlePoVendors = vendorEntries.filter(([, d]) => d.poCount === 1);
  if (singlePoVendors.length && vendorEntries.length > 2) {
    insights.push({ type: 'low-activity-vendor', icon: 'user-minus', title: 'Low-Activity Vendors',
      text: `${singlePoVendors.length} vendor(s) have only a single purchase order on record, including ${singlePoVendors.slice(0, 3).map(v => v[0]).join(', ')}${singlePoVendors.length > 3 ? ', and others' : ''}.` });
  }
  const totalPOs = new Set(rows.map(r => r.poNumber)).size;
  insights.push({ type: 'executive-summary', icon: 'file-text', title: 'Executive Summary',
    text: `This dataset covers ${totalPOs} purchase orders worth ${M(totalGross)} across ${vendorEntries.length} vendors and ${itemAnalysis.length} distinct items. ${duplicates.length} items were repurchased, and ${risingItems.length} show rising price trends.` });

  return insights;
}

/* ---------- Full pipeline ---------- */
function deriveFinancialYear(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'Unknown';
  const y = d.getFullYear(), m = d.getMonth() + 1; // assume Apr-Mar FY (India convention); adjust label only
  if (m >= 4) return `FY ${y}-${String(y + 1).slice(2)}`;
  return `FY ${y - 1}-${String(y).slice(2)}`;
}

function parseExcelDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000;
    return new Date(utcMs);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  // Fast path: values that are already plain numeric strings (the common
  // case for the vast majority of cells) skip the regex-based cleanup
  // entirely. This matters at scale — toNumber runs 9x per row, so for a
  // 100,000-row file that's ~900,000 calls; avoiding an unnecessary regex
  // replace on most of them is a meaningful chunk of total processing time.
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const cleaned = s.replace(/[₹$€,\s]/g, '').replace('%', '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Hoisted out of the per-row processing loop in processDataset (previously
// reallocated on every single row, which was the dominant cost on large
// files — for a 100k-row file this alone accounted for the majority of
// processing time).
const CATEGORY_FILLER_WORDS = new Set(['the','a','an','of','for','to','with','and','or','on','in','at','as','per','by']);

function processDataset(headers, dataRows) {
  const { mapping, mappingIdx, confidence, unmapped } = mapColumns(headers, dataRows.slice(0, 50));

  const rows = dataRows.map(row => {
    const obj = {};
    for (const field of Object.keys(CANONICAL_FIELDS)) {
      const idx = mappingIdx[field];
      obj[field] = idx !== undefined ? row[idx] : null;
    }
    // Type coercion
    obj.slNo = obj.slNo !== null && obj.slNo !== undefined ? toNumber(obj.slNo) : null;
    obj.poNumber = obj.poNumber !== null && obj.poNumber !== undefined ? String(obj.poNumber).trim() : '';
    obj.poRaisedBy = obj.poRaisedBy ? String(obj.poRaisedBy).trim() : '';
    obj.vendorName = obj.vendorName ? String(obj.vendorName).trim() : 'Unknown Vendor';
    obj.vendorAddress = obj.vendorAddress ? String(obj.vendorAddress).trim() : '';
    obj.vendorEmail = obj.vendorEmail ? String(obj.vendorEmail).trim() : '';
    obj.gstn = obj.gstn ? String(obj.gstn).trim() : '';
    obj.itemDescription = obj.itemDescription ? String(obj.itemDescription).trim() : 'Unspecified Item';
    obj.dimension = obj.dimension ? String(obj.dimension).trim() : '';
    obj.unit = obj.unit ? String(obj.unit).trim() : '';
    obj.remarks = obj.remarks ? String(obj.remarks).trim() : '';
    obj.month = obj.month ? String(obj.month).trim() : '';
    obj.category = obj.category ? String(obj.category).trim() : null;

    const parsedDate = parseExcelDate(obj.poDate);
    obj.poDate = parsedDate
      ? `${parsedDate.getFullYear()}-${String(parsedDate.getMonth()+1).padStart(2,'0')}-${String(parsedDate.getDate()).padStart(2,'0')}`
      : null;

    obj.quantity = toNumber(obj.quantity);
    obj.unitRate = toNumber(obj.unitRate);
    obj.discount = toNumber(obj.discount);
    obj.deliveryCharge = toNumber(obj.deliveryCharge);
    obj.taxRate = toNumber(obj.taxRate); // toNumber already strips "%", so "18%" -> 18
    obj.taxAmount = toNumber(obj.taxAmount);
    obj.totalValue = toNumber(obj.totalValue);
    obj.grossAmount = toNumber(obj.grossAmount);
    obj.netTotal = toNumber(obj.netTotal);

    // Derive gross amount if missing but components present (legacy flat-row schema)
    if (!obj.grossAmount && !obj.netTotal && obj.quantity && obj.unitRate) {
      const base = obj.quantity * obj.unitRate - (obj.discount || 0) + (obj.deliveryCharge || 0);
      obj.grossAmount = base + (obj.taxAmount || (obj.taxRate ? base * (obj.taxRate / 100) : 0));
    }
    // Derive tax amount if missing but rate present
    if (!obj.taxAmount && obj.taxRate && obj.quantity && obj.unitRate) {
      obj.taxAmount = (obj.quantity * obj.unitRate) * (obj.taxRate / 100);
    }

    // effectiveAmount: the best single "this row's final money value" figure,
    // preferring the most-final/most-downstream column actually present.
    // Net Total (post-tax PO total) > Gross Amount (pre-net PO total) > Total Value (pre-tax line subtotal).
    obj.effectiveAmount = obj.netTotal || obj.grossAmount || obj.totalValue || 0;
    // effectiveLineValue: the best figure for THIS LINE ITEM specifically (used for
    // item-level analysis), preferring the line subtotal over PO-level totals, since
    // Net Total/Gross Amount usually belong to the whole PO, not just this one line.
    obj.effectiveLineValue = obj.totalValue || obj.grossAmount || obj.netTotal || 0;

    obj.financialYear = obj.financialYear ? String(obj.financialYear).trim() : (obj.poDate ? deriveFinancialYear(obj.poDate) : 'Unknown');
    if (!obj.category) {
      // Fallback for files with no real category column: take the first 1-3
      // meaningful words of the item description, skipping common filler
      // words that would otherwise dominate (sentence-style descriptions
      // like "Painting with primer and putty to the wall" shouldn't become
      // category "Painting" if a more specific noun phrase is available —
      // but with no taxonomy to draw on, this remains an approximation,
      // not a true category; it exists so the Category chart/filter has
      // something reasonable to show rather than nothing.
      const words = obj.itemDescription.split(/\s+/).filter(w => w && !CATEGORY_FILLER_WORDS.has(w.toLowerCase()));
      obj.category = words.slice(0, 2).join(' ') || 'Uncategorized';
    }
    return obj;
  }).filter(r => (r.itemDescription && r.itemDescription !== 'Unspecified Item') || r.poNumber); // drop fully-empty rows

  return computeAggregates(rows, { mapping, confidence, unmapped });
}

/**
 * Computes every derived aggregate (KPIs, vendor totals, monthly trend,
 * category totals, FY totals, tax breakdown, discount summary, item
 * analysis, and insights) from a set of already-normalized rows (the
 * objects processDataset() produces per row).
 *
 * This is the single source of truth for aggregation logic — both the
 * initial full-dataset processing AND the live filter-recompute path
 * (used when the user changes a filter) call this same function, so
 * the two can never drift out of sync with each other.
 *
 * @param {Array<Object>} rows - normalized PO row objects
 * @param {Object} [extra] - optional passthrough fields (mapping, confidence, unmapped)
 *   included in the returned object as-is, for callers that have them (processDataset)
 *   and omitted for callers that don't (the filtered-subset recompute path).
 */
function computeAggregates(rows, extra) {
  // ---- PO-level rollup ----
  // Many real PO files (e.g. PO Tracker exports) carry one row per PO with the
  // financial total, plus several more rows per PO that are pure line items with
  // no PO-level total of their own. Summing effectiveAmount across every row of
  // a PO would massively over-count. Instead, roll up to ONE effective amount
  // per PO: take the largest effectiveAmount seen on any of that PO's rows
  // (covers the common case where exactly one row in the group carries it),
  // and fall back to summing that PO's line-item values only if no row carried
  // any PO-level total at all.
  const poGroups = new Map();
  for (const r of rows) {
    const key = r.poNumber || `__no_po_${poGroups.size}`;
    if (!poGroups.has(key)) poGroups.set(key, []);
    poGroups.get(key).push(r);
  }
  // Single combined pass: for each PO, resolve both its effective total
  // amount AND its "attribution row" (the row whose vendor/date/FY the
  // total should be credited to) in one filter+reduce, instead of redoing
  // this same per-PO-group computation 4 separate times across vendor
  // totals, monthly trend, FY totals, and the gross-amount sum below. On a
  // 100,000-row dataset this combined pass measured ~4x faster than the
  // previous repeated-computation version, which was enough to freeze the
  // UI for over a second every time filters were cleared back to "All".
  const poEffectiveAmount = new Map(); // poNumber -> resolved total for that PO
  const poAttributionRow = new Map();  // poNumber -> the row to credit vendor/date/FY to
  for (const [poNum, poRows] of poGroups.entries()) {
    let maxAmount = 0, maxRow = null, sumLineValue = 0;
    for (const r of poRows) {
      if (r.effectiveAmount > 0 && (maxRow === null || r.effectiveAmount > maxAmount)) {
        maxAmount = r.effectiveAmount;
        maxRow = r;
      }
      sumLineValue += r.effectiveLineValue || 0;
    }
    if (maxRow) {
      poEffectiveAmount.set(poNum, maxAmount);
      poAttributionRow.set(poNum, maxRow);
    } else {
      // No row carried a PO-level total at all — fall back to summing line items
      poEffectiveAmount.set(poNum, sumLineValue);
      poAttributionRow.set(poNum, poRows[0]);
    }
  }

  // KPIs — sum ONE resolved amount per PO, not per row
  const totalPurchaseValue = Array.from(poEffectiveAmount.values()).reduce((s, v) => s + v, 0);
  const totalPOs = poGroups.size;
  const totalVendors = new Set(rows.map(r => r.vendorName)).size;
  const itemAnalysis = aggregateItems(rows);
  attachPriceAnalysis(itemAnalysis);
  const totalItems = itemAnalysis.length;
  const validRates = rows.map(r => r.unitRate).filter(r => r > 0);
  const avgUnitRate = validRates.length ? validRates.reduce((s, r) => s + r, 0) / validRates.length : 0;
  const highestItem = itemAnalysis[0] || null;

  // Vendor totals — one resolved amount per PO, attributed to that PO's vendor
  const vendorTotals = {};
  for (const [poNum, poRows] of poGroups.entries()) {
    const vendor = poAttributionRow.get(poNum).vendorName;
    if (!vendorTotals[vendor]) vendorTotals[vendor] = { total: 0, pos: new Set(), items: new Set() };
    vendorTotals[vendor].total += poEffectiveAmount.get(poNum) || 0;
    vendorTotals[vendor].pos.add(poNum);
    for (const r of poRows) vendorTotals[vendor].items.add(normalizeItemKey(r.itemDescription));
  }
  for (const v of Object.values(vendorTotals)) v.poCount = v.pos.size;

  // Monthly trend — one resolved amount per PO, bucketed by that PO's date
  const monthlyMap = {};
  for (const poNum of poGroups.keys()) {
    const attributionRow = poAttributionRow.get(poNum);
    if (!attributionRow.poDate) continue;
    const key = attributionRow.poDate.slice(0, 7);
    monthlyMap[key] = (monthlyMap[key] || 0) + (poEffectiveAmount.get(poNum) || 0);
  }
  const monthlyTrend = Object.entries(monthlyMap).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, total]) => ({ key, label: monthLabel(key), total: round2(total) }));

  // Category totals — line-item level (categories describe items, not POs), uses
  // effectiveLineValue. Grouped case-insensitively so casing variants of the same
  // category text (e.g. "Steel Rod" vs "steel rod", common when category is a
  // derived fallback from inconsistently-cased item descriptions) merge into one
  // bucket instead of silently splitting the same category into two rows.
  const categoryTotalsRaw = {};
  const categoryDisplayLabel = {};
  for (const r of rows) {
    if (!isLineItemRow(r)) continue;
    const catKey = String(r.category || 'Uncategorized').toLowerCase().trim();
    if (!(catKey in categoryDisplayLabel)) categoryDisplayLabel[catKey] = r.category || 'Uncategorized';
    categoryTotalsRaw[catKey] = (categoryTotalsRaw[catKey] || 0) + (r.effectiveLineValue || 0);
  }
  // Re-key the totals object by display label so downstream chart/UI code (which
  // expects human-readable category names) is unaffected by this internal change.
  const categoryTotals = {};
  for (const [key, val] of Object.entries(categoryTotalsRaw)) categoryTotals[categoryDisplayLabel[key]] = val;

  // FY totals — one resolved amount per PO, bucketed by that PO's financial year
  const fyTotals = {};
  for (const poNum of poGroups.keys()) {
    const fy = poAttributionRow.get(poNum).financialYear || 'Unknown';
    fyTotals[fy] = (fyTotals[fy] || 0) + (poEffectiveAmount.get(poNum) || 0);
  }

  // Tax analysis — line-item level tax amounts (kept as-is; sparse Total Tax values
  // are typically only present on the PO-level row, which is fine to bucket individually)
  const taxByRate = {};
  for (const r of rows) {
    if (!r.taxRate && !r.taxAmount) continue;
    const key = r.taxRate ? `${r.taxRate}%` : 'No Tax';
    if (!taxByRate[key]) taxByRate[key] = { count: 0, amount: 0 };
    taxByRate[key].count++;
    taxByRate[key].amount += r.taxAmount;
  }

  // Discount analysis
  const totalDiscount = rows.reduce((s, r) => s + r.discount, 0);
  const itemsWithDiscount = rows.filter(r => r.discount > 0).length;

  const insights = generateInsights({ rows, itemAnalysis, vendorTotals, monthlyTrend, totalPurchaseValue });

  return {
    rows, ...(extra || {}),
    kpis: { totalPurchaseValue: round2(totalPurchaseValue), totalPOs, totalVendors, totalItems, avgUnitRate: round2(avgUnitRate), highestItem },
    itemAnalysis, vendorTotals, monthlyTrend, categoryTotals, fyTotals, taxByRate,
    discountAnalysis: { totalDiscount: round2(totalDiscount), itemsWithDiscount },
    insights
  };
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

// Export for Node (testing), browser main thread, and Web Worker contexts.
// Workers have no `window` global — their global object is `self` — so we
// check for that too; this lets data-core.js run unmodified inside the
// background-processing worker used for large file uploads.
const PODataCore = { mapColumns, aggregateItems, generateInsights, processDataset, computeAggregates, normalizeItemKey, fmtMoney, CANONICAL_FIELDS, isLineItemRow };
if (typeof module !== 'undefined') module.exports = PODataCore;
if (typeof window !== 'undefined') window.PODataCore = PODataCore;
else if (typeof self !== 'undefined') self.PODataCore = PODataCore;
