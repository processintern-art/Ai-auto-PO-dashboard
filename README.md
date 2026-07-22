# AI Auto PO Dashboard Generator

A fully client-side, single-page web application that turns any Purchase Order Excel/CSV export into a complete analytics dashboard — automatically, with one click, and with **no manual column mapping**.

Everything runs in your browser. Your data is never uploaded to any server.

---

## Status of the Enterprise AI Procurement Intelligence Extension

This build includes the **data and performance layer** of the requested enterprise extension, fully implemented and tested against a real 160-row PO file:

**Implemented and verified:**
- AI Price Change Root Cause Analysis — every duplicate item's purchase history is automatically compared (vendor, date, quantity, rate, discount, delivery, tax, dimension, UOM) and explained in plain English, using only the data actually present — never an invented reason
- AI Confidence Score for every explanation, traceable to the specific factors detected
- Performance: handles 100,000+ row files without freezing the page (background Web Worker processing during upload, with automatic fallback if Workers aren't available; an "all filters cleared" fast path that avoids redundant recomputation)
- Drill-down on Vendor, Item, Category, and Financial Year charts (click a bar/segment to filter the whole dashboard, with a breadcrumb trail)
- All previously existing functionality preserved: column auto-mapping, KPIs, charts, filters, vendor/item analysis, AI insights, dark mode, CSV/Excel/PDF/PowerPoint/HTML exports

**Not yet implemented** (the engine above is what these would be built on, but the UI itself doesn't exist yet):
- "Why?" button + comparison modal on duplicate item rows
- Savings Opportunity calculation and dashboard KPI
- Smart Purchase Recommendation panel
- Vendor Scorecard (0–100 score per vendor)
- Executive Summary card
- Smart Alert cards (price increase, bulk discount, high tax, etc.)
- Drill-down on the Monthly Trend chart specifically (Vendor/Item/Category/FY drill-down all work; Month does not yet)

If you'd like these finished, just ask and I'll continue from here — the underlying analysis engine they depend on is already built and tested, so this is UI work on top of a solid foundation rather than starting over.

---

## How to Use

1. Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari).
2. Drag & drop your PO file onto the upload zone, click **Browse File**, or paste a public Google Sheets link.
3. If the file has multiple sheets, pick the right one from the tabs that appear.
4. Review the auto-detected column mapping shown in the preview (each matched column gets a small blue badge naming the field it was mapped to).
5. Click **Generate Dashboard**.
6. Use the sidebar to move between the Dashboard, Charts, Item Analysis, Vendor Analysis, AI Insights, and raw Data Table views.
7. Use the filters bar (Financial Year, Vendor, Item, Category, Tax Rate, PO Number, PO Raised By, Date Range) — every KPI, chart, and table updates live.
8. **Drill down**: charts marked "Click to drill down" (Vendor Wise, Item Wise, Category Wise, Financial Year, Top 10 Cost Items, Top 10 Frequent Items) are clickable — click a bar or segment to filter the whole dashboard to that value. A breadcrumb trail appears showing your drill path (e.g. "Vendor: Acme Corp › Item: Steel Rod"); click the × on any level to undo it, or "Clear All" to reset. Drilling and the regular filter dropdowns stay in sync either way.
9. Use **Export** in the top-right to download:
   - Interactive HTML Dashboard (a self-contained snapshot file)
   - PDF Report
   - Excel Summary (multi-sheet workbook)
   - PowerPoint Report
   - CSV Summary

A ready-to-try sample file is included at `sample-data/Sample_PO_Data.xlsx` (60 rows, 5 vendors, intentional duplicate items so you can see the duplicate-detection and price-trend features in action).

---

## What Happens Automatically

**Column detection** — The app reads your header row (auto-located even if there are title rows or blank rows above it) and matches each column to a canonical PO field — PO Number, PO Date, Vendor, Item, Quantity, Unit, Unit Rate, Discount, Delivery Charge, Tax Rate, Tax Amount, Gross Amount, Financial Year — using a synonym dictionary plus fuzzy text matching plus a check of the actual cell values (so "Amount" next to numbers maps differently than "Amount" next to text). Nothing is hardcoded to one file's specific column names.

**Duplicate item analysis** — Line items are grouped by a normalized version of the item description (case/spacing/punctuation-insensitive) and rolled up into: total quantity, average/latest/min/max unit rate, price difference, % price change over time, purchase frequency, vendor count, and total value.

**Missing-value handling** — If Gross Amount or Tax Amount is blank but Quantity, Rate, and Tax Rate are present, the app derives them rather than showing zeros.

**AI Insights** — A rules engine (not a hosted LLM call, so it's instant and free) scans the processed data for: highest-spending vendor, most-purchased item, items with rising prices, cost-saving opportunities across vendors, duplicate purchases, vendor price comparisons, purchase trend direction, tax summary, low-activity vendors, and an executive summary.

---

## Supported PO File Formats

The column auto-mapper recognizes two common PO file layouts out of the box, and falls back gracefully for anything in between:

**1. Flat-row format** — one row per line item, with a single running total column (PO Number, PO Date, Vendor, Item Description, Quantity, Unit Rate, Gross Amount, etc.)

**2. PO Tracker format** — seen in real exports such as "Administration Purchase Order Tracker," where each PO can span multiple rows: one row carries the PO-level financial totals (Tax Rate, Total Tax, Gross Amount, Net Total), and the rows beneath it are line items (Qty, Unit Rate, Total Value) with no totals of their own. Recognized fields include: Sl. No, P.O. No, P.O. Date, PO Raised By, Vendor Name, Vendor Address, Vendor Email, GSTN, Description of Item, Dimension, Qty, UOM, Unit Rate, Total Value, Tax Rate, Total Tax, Gross Amount, Net Total, Remarks, Month, Year.

Because this second format is so common, the app treats **Total Value**, **Gross Amount**, and **Net Total** as three separate fields rather than merging them — Total Value is the pre-tax line subtotal, Gross Amount is the PO's pre-net total, and Net Total is the PO's final post-tax total. When computing dashboard totals, the app resolves one effective amount per PO (preferring Net Total, then Gross Amount, then summed line items) rather than summing every row, which avoids double-counting on multi-row POs. Rows that carry only a PO-level total with no quantity/rate/line-value of their own (i.e. PO-summary rows) are excluded from item-level analysis, so a stray label in the Description field on a totals row can't be misread as a purchased item.

Blank or placeholder trailing columns (e.g. "Unnamed: 23") are automatically ignored.

## Project Structure

```
index.html          Main application shell (sidebar, topbar, all views)
styles.css          Corporate blue/white design system + dark mode
lib-loader.js       Loads Chart.js / SheetJS / jsPDF / PptxGenJS from multiple
                     CDN mirrors with fallback, and verifies each library's
                     global actually exists before the app starts
app.js              UI controller: upload, header detection, filters, rendering, exports
data-core.js        Column auto-mapping + duplicate-item aggregation + insights engine
price-analysis.js   AI price change root cause analysis + confidence scoring engine
data-worker.js      Web Worker for off-main-thread processing of large files (100,000+ rows)
charts.js           Chart.js configuration builders for all 10 chart types
export-csv.js       CSV Summary export
export-excel.js     Multi-sheet Excel Summary export (SheetJS)
export-pdf.js       PDF Report export (jsPDF + autotable)
export-pptx.js      PowerPoint Report export (PptxGenJS)
sample-data/        Sample PO Excel file to try the app with immediately
```

## Technologies Used

- **Parsing:** SheetJS (xlsx) — reads .xlsx / .xls / .csv, multi-sheet
- **Charts:** Chart.js
- **PDF export:** jsPDF + jsPDF-autotable
- **PowerPoint export:** PptxGenJS
- **Everything else:** vanilla HTML5 / CSS3 / JavaScript — no build step, no backend required

External libraries are loaded by `lib-loader.js`, which tries jsdelivr, then cdnjs, then unpkg for each one, and confirms the library's actual global (e.g. `window.Chart`) exists before letting the rest of the app start. If every mirror for a library fails (e.g. all CDNs are blocked on your network), the page shows a clear on-screen message naming exactly which library couldn't load, instead of a silent console error. This requires an internet connection on first load; after that, most browsers cache the libraries.

> The original brief specified a Python (Flask/FastAPI) backend with Pandas/OpenPyXL. This version implements the equivalent logic entirely client-side in JavaScript instead, so the whole tool is just one folder you can open directly in a browser — no server to install, configure, or host. If you specifically need a Python backend (e.g. to process files server-side, schedule recurring imports, or integrate with a database), that would be a separate build — let me know and I can put one together.

## Notes & Known Limitations

- **Google Sheets import** requires the sheet to be shared as "Anyone with the link can view," since the app fetches it as a public CSV export — there's no OAuth login flow in this build.
- **AI Insights** are generated by statistical rules, not a hosted language model — this keeps them instant and free to run, but they're pattern-based observations rather than open-ended natural-language analysis.
- **Financial Year** is inferred using the April–March convention when not present in the source file; if your organization uses a different fiscal calendar, override the Financial Year column in your source file and it will be used as-is.
- Because everything runs in the browser, very large files (tens of thousands of rows) may take a few seconds longer to process than on a server — there's no enforced row limit, but performance will depend on the user's device.
