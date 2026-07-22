/* ============================================================
   PO Dashboard — PDF Report Export (jsPDF + autotable)
   Builds a multi-page executive PDF: cover/KPIs, insights,
   item analysis table, vendor analysis table.
   ============================================================ */
(function (global) {
  const BLUE = [29, 78, 216];
  const SLATE = [71, 85, 105];
  const LIGHT = [241, 245, 249];

  function fmtMoney(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function exportPdfReport(state) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;

    // --- Page 1: Cover + KPIs ---
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, pageWidth, 110, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('Purchase Order Analytics Report', margin, 50);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, 75);

    let y = 145;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Key Metrics', margin, y);
    y += 20;

    const k = state.kpis;
    const kpiPairs = [
      ['Total Purchase Value', fmtMoney(k.totalPurchaseValue)],
      ['Total Purchase Orders', String(k.totalPOs)],
      ['Total Vendors', String(k.totalVendors)],
      ['Total Distinct Items', String(k.totalItems)],
      ['Average Unit Rate', fmtMoney(k.avgUnitRate)],
      ['Highest Value Item', k.highestItem ? truncate(k.highestItem.itemDescription, 38) : 'N/A']
    ];

    const colWidth = (pageWidth - margin * 2) / 2;
    kpiPairs.forEach((pair, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = margin + col * colWidth;
      const cardY = y + row * 58;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x, cardY, colWidth - 12, 48, 6, 6, 'F');
      doc.setTextColor(...SLATE);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(pair[0], x + 12, cardY + 18);
      doc.setTextColor(...BLUE);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(pair[1], x + 12, cardY + 38);
    });

    y = y + Math.ceil(kpiPairs.length / 2) * 58 + 25;

    // --- AI Insights ---
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('AI-Generated Insights', margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    for (const insight of state.insights) {
      if (y > 760) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...BLUE);
      doc.text('• ' + insight.title, margin, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(insight.text, pageWidth - margin * 2 - 10);
      doc.text(lines, margin + 10, y);
      y += lines.length * 12 + 8;
    }

    // --- Item Analysis Table ---
    doc.addPage();
    y = 50;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Item Analysis (Duplicate Purchase Detection)', margin, y);

    const itemBody = state.itemAnalysis.slice(0, 40).map(i => [
      truncate(i.itemDescription, 70), String(i.purchaseFrequency), i.totalQuantity.toLocaleString('en-IN'),
      fmtMoney(i.avgUnitRate), fmtMoney(i.minRate), fmtMoney(i.maxRate), fmtMoney(i.totalPurchaseValue), i.trend
    ]);
    doc.autoTable({
      startY: y + 15,
      head: [['Item', 'Freq', 'Total Qty', 'Avg Rate', 'Min Rate', 'Max Rate', 'Total Value', 'Trend']],
      body: itemBody,
      styles: { fontSize: 8, cellPadding: 5 },
      headStyles: { fillColor: BLUE, textColor: 255 },
      alternateRowStyles: { fillColor: LIGHT },
      margin: { left: margin, right: margin }
    });

    // --- Vendor Analysis Table ---
    doc.addPage();
    y = 50;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('Vendor Analysis', margin, y);

    const vendorBody = Object.entries(state.vendorTotals)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => [name, fmtMoney(d.total), String(d.poCount), String(d.items.size)]);
    doc.autoTable({
      startY: y + 15,
      head: [['Vendor', 'Total Spend', 'PO Count', 'Distinct Items']],
      body: vendorBody,
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: BLUE, textColor: 255 },
      alternateRowStyles: { fillColor: LIGHT },
      margin: { left: margin, right: margin }
    });

    // Footer page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 50, doc.internal.pageSize.getHeight() - 20);
    }

    doc.save('PO_Analytics_Report.pdf');
  }

  global.POExportPdf = { exportPdfReport };
})(typeof window !== 'undefined' ? window : globalThis);
