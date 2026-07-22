/* ============================================================
   PO Dashboard — Excel Export (SheetJS)
   Produces a multi-sheet workbook: KPI Summary, Item Analysis,
   Vendor Analysis, Monthly Trend, Raw Data.
   ============================================================ */
(function (global) {
  function buildWorkbook(state) {
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();

    // --- Sheet 1: KPI Summary ---
    const k = state.kpis;
    const summaryData = [
      ['Purchase Order Analytics — Summary Report'],
      ['Generated', new Date().toLocaleString()],
      [],
      ['KPI', 'Value'],
      ['Total Purchase Value', k.totalPurchaseValue],
      ['Total Purchase Orders', k.totalPOs],
      ['Total Vendors', k.totalVendors],
      ['Total Distinct Items', k.totalItems],
      ['Average Unit Rate', k.avgUnitRate],
      ['Highest Value Item', k.highestItem ? k.highestItem.itemDescription : 'N/A'],
      ['Highest Value Item — Total Spend', k.highestItem ? k.highestItem.totalPurchaseValue : 0],
      [],
      ['Discount Summary'],
      ['Total Discount Given', state.discountAnalysis.totalDiscount],
      ['Line Items With Discount', state.discountAnalysis.itemsWithDiscount]
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 32 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'KPI Summary');

    // --- Sheet 2: Item Analysis (duplicate item analytics) ---
    const itemHeaders = ['Item Description', 'Category', 'Purchase Frequency', 'Total Quantity',
      'Avg Unit Rate', 'Latest Unit Rate', 'Earliest Unit Rate', 'Min Rate', 'Max Rate',
      'Price Difference', 'Price Change %', 'Total Purchase Value', 'Vendor Count', 'Vendors', 'Trend'];
    const itemRows = state.itemAnalysis.map(i => [
      i.itemDescription, i.category, i.purchaseFrequency, i.totalQuantity, i.avgUnitRate,
      i.latestUnitRate, i.earliestUnitRate, i.minRate, i.maxRate, i.priceDifference,
      i.priceChangePct, i.totalPurchaseValue, i.vendorCount, i.vendors.join('; '), i.trend
    ]);
    const wsItems = XLSX.utils.aoa_to_sheet([itemHeaders, ...itemRows]);
    wsItems['!cols'] = itemHeaders.map((h, idx) => ({ wch: idx === 0 ? 30 : idx === 13 ? 28 : 14 }));
    XLSX.utils.book_append_sheet(wb, wsItems, 'Item Analysis');

    // --- Sheet 3: Vendor Analysis ---
    const vendorHeaders = ['Vendor Name', 'Total Purchase Value', 'PO Count', 'Distinct Items Supplied'];
    const vendorRows = Object.entries(state.vendorTotals)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => [name, round2(d.total), d.poCount, d.items.size]);
    const wsVendors = XLSX.utils.aoa_to_sheet([vendorHeaders, ...vendorRows]);
    wsVendors['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsVendors, 'Vendor Analysis');

    // --- Sheet 4: Monthly Trend ---
    const trendHeaders = ['Month', 'Total Purchase Value'];
    const trendRows = state.monthlyTrend.map(m => [m.label, m.total]);
    const wsTrend = XLSX.utils.aoa_to_sheet([trendHeaders, ...trendRows]);
    wsTrend['!cols'] = [{ wch: 16 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsTrend, 'Monthly Trend');

    // --- Sheet 5: Raw Data (normalized) ---
    const rawHeaders = ['Sl. No', 'PO Number', 'PO Date', 'PO Raised By', 'Vendor Name', 'Vendor Address',
      'Vendor Email', 'GSTN', 'Item Description', 'Dimension', 'Quantity', 'Unit', 'Unit Rate',
      'Total Value', 'Tax Rate', 'Total Tax', 'Gross Amount', 'Net Total', 'Remarks', 'Month', 'Year', 'Category'];
    const rawRows = state.rows.map(r => [
      r.slNo, r.poNumber, r.poDate, r.poRaisedBy, r.vendorName, r.vendorAddress, r.vendorEmail, r.gstn,
      r.itemDescription, r.dimension, r.quantity, r.unit, r.unitRate, r.totalValue, r.taxRate, r.taxAmount,
      r.grossAmount, r.netTotal, r.remarks, r.month, r.financialYear, r.category
    ]);
    const wsRaw = XLSX.utils.aoa_to_sheet([rawHeaders, ...rawRows]);
    wsRaw['!cols'] = rawHeaders.map((h) => ({ wch: ['Item Description', 'Vendor Address', 'Remarks', 'Dimension'].includes(h) ? 30 : 16 }));
    XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw Data');

    return wb;
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function exportExcelSummary(state) {
    const wb = buildWorkbook(state);
    global.XLSX.writeFile(wb, 'PO_Dashboard_Summary.xlsx');
  }

  global.POExportExcel = { exportExcelSummary, buildWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
