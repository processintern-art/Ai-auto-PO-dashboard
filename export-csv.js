/* ============================================================
   PO Dashboard — CSV Export
   ============================================================ */
(function (global) {
  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(headers, rows) {
    const lines = [headers.map(escapeCsvCell).join(',')];
    for (const row of rows) lines.push(row.map(escapeCsvCell).join(','));
    return lines.join('\r\n');
  }

  function downloadCsv(filename, csvString) {
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Builds and downloads a CSV summary: item analysis table.
   */
  function exportCsvSummary(state) {
    const headers = ['Item Description', 'Category', 'Purchase Frequency', 'Total Quantity', 'Avg Unit Rate',
      'Latest Unit Rate', 'Min Rate', 'Max Rate', 'Price Difference', 'Price Change %', 'Total Purchase Value',
      'Vendor Count', 'Vendors', 'Duplicate?'];
    const rows = state.itemAnalysis.map(i => [
      i.itemDescription, i.category, i.purchaseFrequency, i.totalQuantity, i.avgUnitRate,
      i.latestUnitRate, i.minRate, i.maxRate, i.priceDifference, i.priceChangePct, i.totalPurchaseValue,
      i.vendorCount, i.vendors.join('; '), i.isDuplicate ? 'Yes' : 'No'
    ]);
    downloadCsv('PO_Summary.csv', rowsToCsv(headers, rows));
  }

  global.POExportCsv = { exportCsvSummary, downloadCsv, rowsToCsv };
})(typeof window !== 'undefined' ? window : globalThis);
