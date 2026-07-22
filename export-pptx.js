/* ============================================================
   PO Dashboard — PowerPoint Export (PptxGenJS)
   Builds an executive deck: title, KPIs, insights, top vendors,
   top items, monthly trend.
   Safe fonts only (Calibri/Arial) for reliable rendering.
   ============================================================ */
(function (global) {
  const NAVY = '1D4ED8';
  const DARK = '0F172A';
  const SLATE = '475569';
  const LIGHT = 'F1F5F9';
  const WHITE = 'FFFFFF';
  const TEAL = '0D9488';

  function fmtMoney(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function exportPptxReport(state) {
    const pptx = new global.PptxGenJS();
    pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
    pptx.layout = 'WIDE';

    // --- Slide 1: Title ---
    let slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: NAVY } });
    slide.addText('Purchase Order Analytics', {
      x: 0.8, y: 2.7, w: 11.5, h: 1.2, fontSize: 40, bold: true, color: WHITE, fontFace: 'Calibri'
    });
    slide.addText('Executive Summary Report', {
      x: 0.8, y: 3.75, w: 11.5, h: 0.6, fontSize: 18, color: 'CADCFC', fontFace: 'Calibri'
    });
    slide.addText(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), {
      x: 0.8, y: 6.6, w: 6, h: 0.4, fontSize: 12, color: 'CADCFC', fontFace: 'Calibri'
    });

    // --- Slide 2: KPIs ---
    slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addText('Key Performance Indicators', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: 'Calibri' });

    const k = state.kpis;
    const kpis = [
      ['Total Purchase Value', fmtMoney(k.totalPurchaseValue)],
      ['Total Purchase Orders', String(k.totalPOs)],
      ['Total Vendors', String(k.totalVendors)],
      ['Total Distinct Items', String(k.totalItems)],
      ['Average Unit Rate', fmtMoney(k.avgUnitRate)],
      ['Highest Value Item', k.highestItem ? truncate(k.highestItem.itemDescription, 28) : 'N/A']
    ];
    const cardW = 3.9, cardH = 2.1, gapX = 0.25, gapY = 0.25, startX = 0.6, startY = 1.3;
    kpis.forEach((pair, idx) => {
      const col = idx % 3, row = Math.floor(idx / 3);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      slide.addShape('roundRect', { x, y, w: cardW, h: cardH, fill: { color: LIGHT }, rectRadius: 0.08, line: { color: 'E2E8F0', width: 1 } });
      slide.addText(pair[0], { x: x + 0.25, y: y + 0.2, w: cardW - 0.5, h: 0.5, fontSize: 13, color: SLATE, fontFace: 'Calibri' });
      slide.addText(pair[1], { x: x + 0.25, y: y + 0.75, w: cardW - 0.5, h: 1.0, fontSize: 26, bold: true, color: NAVY, fontFace: 'Calibri' });
    });

    // --- Slide 3: AI Insights ---
    slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addText('AI-Generated Insights', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: 'Calibri' });
    const topInsights = state.insights.slice(0, 6);
    const insightRows = [];
    topInsights.forEach((ins, idx) => {
      insightRows.push([
        { text: ins.title, options: { bold: true, color: NAVY, fontSize: 12 } },
        { text: ins.text, options: { color: SLATE, fontSize: 11 } }
      ]);
    });
    slide.addTable(insightRows, {
      x: 0.6, y: 1.2, w: 12.1, h: 5.8,
      colW: [3.2, 8.9],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      autoPage: false,
      valign: 'top',
      fontFace: 'Calibri',
      margin: 6
    });

    // --- Slide 4: Top Vendors ---
    slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addText('Top Vendors by Spend', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: 'Calibri' });
    const vendorEntries = Object.entries(state.vendorTotals).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
    const vendorTableRows = [[
      { text: 'Vendor', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Total Spend', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'PO Count', options: { bold: true, color: WHITE, fill: { color: NAVY } } }
    ]];
    vendorEntries.forEach(([name, d]) => {
      vendorTableRows.push([
        { text: truncate(name, 35), options: { color: DARK } },
        { text: fmtMoney(d.total), options: { color: DARK } },
        { text: String(d.poCount), options: { color: DARK } }
      ]);
    });
    slide.addTable(vendorTableRows, {
      x: 0.6, y: 1.2, w: 12.1, h: 5.8,
      colW: [6.5, 3.3, 2.3],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      fontSize: 12,
      fontFace: 'Calibri',
      autoPage: false
    });

    // --- Slide 5: Top Items ---
    slide = pptx.addSlide();
    slide.background = { color: WHITE };
    slide.addText('Top Items by Purchase Value', { x: 0.6, y: 0.4, w: 12, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: 'Calibri' });
    const topItems = state.itemAnalysis.slice(0, 8);
    const itemTableRows = [[
      { text: 'Item', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Frequency', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Total Value', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Trend', options: { bold: true, color: WHITE, fill: { color: NAVY } } }
    ]];
    topItems.forEach(item => {
      itemTableRows.push([
        { text: truncate(item.itemDescription, 32), options: { color: DARK } },
        { text: String(item.purchaseFrequency), options: { color: DARK } },
        { text: fmtMoney(item.totalPurchaseValue), options: { color: DARK } },
        { text: item.trend, options: { color: item.trend === 'increasing' ? 'D97706' : item.trend === 'decreasing' ? TEAL : SLATE } }
      ]);
    });
    slide.addTable(itemTableRows, {
      x: 0.6, y: 1.2, w: 12.1, h: 5.8,
      colW: [5.5, 2.2, 2.7, 1.7],
      border: { type: 'solid', color: 'E2E8F0', pt: 0.5 },
      fontSize: 12,
      fontFace: 'Calibri',
      autoPage: false
    });

    // --- Slide 6: Closing / Executive Summary ---
    slide = pptx.addSlide();
    slide.background = { color: NAVY };
    const execInsight = state.insights.find(i => i.type === 'executive-summary');
    slide.addText('Executive Summary', { x: 0.8, y: 0.7, w: 11.5, h: 0.8, fontSize: 30, bold: true, color: WHITE, fontFace: 'Calibri' });
    slide.addText(execInsight ? execInsight.text : '', {
      x: 0.8, y: 1.9, w: 11.5, h: 3, fontSize: 16, color: 'CADCFC', fontFace: 'Calibri', valign: 'top'
    });

    pptx.writeFile({ fileName: 'PO_Analytics_Report.pptx' });
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  global.POExportPptx = { exportPptxReport };
})(typeof window !== 'undefined' ? window : globalThis);
