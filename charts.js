/* ============================================================
   PO Dashboard — Charts
   Builds Chart.js configs for all required chart types, themed
   for the corporate blue/white palette with dark-mode variants.
   ============================================================ */
(function (global) {
  const PALETTE_LIGHT = {
    primary: '#1d4ed8', primaryLight: '#60a5fa', secondary: '#0d9488',
    warn: '#d97706', danger: '#dc2626', grid: '#e2e8f0', text: '#334155',
    series: ['#1d4ed8', '#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#475569', '#ea580c']
  };
  const PALETTE_DARK = {
    primary: '#60a5fa', primaryLight: '#93c5fd', secondary: '#2dd4bf',
    warn: '#fbbf24', danger: '#f87171', grid: '#293548', text: '#cbd5e1',
    series: ['#60a5fa', '#2dd4bf', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#a3e635', '#f472b6', '#94a3b8', '#fb923c']
  };

  function palette(isDark) { return isDark ? PALETTE_DARK : PALETTE_LIGHT; }

  function baseOptions(isDark, extra) {
    const p = palette(isDark);
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: p.text, font: { size: 11 } } },
        tooltip: { backgroundColor: isDark ? '#1e293b' : '#ffffff', titleColor: p.text, bodyColor: p.text, borderColor: p.grid, borderWidth: 1 }
      },
      scales: {
        x: { ticks: { color: p.text }, grid: { color: p.grid } },
        y: { ticks: { color: p.text }, grid: { color: p.grid } }
      }
    }, extra || {});
  }

  /* 1. Monthly Purchase Trend (line) */
  function monthlyTrendConfig(state, isDark) {
    const p = palette(isDark);
    return {
      type: 'line',
      data: {
        labels: state.monthlyTrend.map(m => m.label),
        datasets: [{
          label: 'Purchase Value', data: state.monthlyTrend.map(m => m.total),
          borderColor: p.primary, backgroundColor: hexAlpha(p.primary, 0.12),
          fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: p.primary
        }]
      },
      options: baseOptions(isDark)
    };
  }

  /* 2. Vendor Wise Purchase (bar) */
  function vendorWiseConfig(state, isDark) {
    const p = palette(isDark);
    const entries = Object.entries(state.vendorTotals).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    return {
      type: 'bar',
      data: {
        labels: entries.map(([name]) => truncate(name, 18)),
        // Full, untruncated vendor names in the same order as labels/data — used
        // for drill-down click handling, since the truncated display label is
        // lossy and can't be reliably reversed back into the real filter value.
        fullValues: entries.map(([name]) => name),
        datasets: [{ label: 'Purchase Value', data: entries.map(([, d]) => round2(d.total)), backgroundColor: p.primary, borderRadius: 4 }]
      },
      options: baseOptions(isDark, { indexAxis: 'y' })
    };
  }

  /* 3. Item Wise Purchase (bar, top 10 by value) */
  function itemWiseConfig(state, isDark) {
    const p = palette(isDark);
    const top = state.itemAnalysis.slice(0, 10);
    return {
      type: 'bar',
      data: {
        labels: top.map(i => truncate(i.itemDescription, 18)),
        fullValues: top.map(i => i.itemDescription),
        datasets: [{ label: 'Purchase Value', data: top.map(i => i.totalPurchaseValue), backgroundColor: p.secondary, borderRadius: 4 }]
      },
      options: baseOptions(isDark, { indexAxis: 'y' })
    };
  }

  /* 4. Category Wise Purchase (doughnut) */
  function categoryWiseConfig(state, isDark) {
    const p = palette(isDark);
    const entries = Object.entries(state.categoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return {
      type: 'doughnut',
      data: {
        labels: entries.map(([name]) => name),
        fullValues: entries.map(([name]) => name),
        datasets: [{ data: entries.map(([, v]) => round2(v)), backgroundColor: p.series, borderWidth: 2, borderColor: isDark ? '#141b2d' : '#ffffff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: p.text, boxWidth: 12, font: { size: 10 } } } } }
    };
  }

  /* 5. Tax Analysis (bar by tax rate bucket) */
  function taxAnalysisConfig(state, isDark) {
    const p = palette(isDark);
    const entries = Object.entries(state.taxByRate);
    return {
      type: 'bar',
      data: {
        labels: entries.map(([rate]) => rate),
        datasets: [{ label: 'Tax Amount', data: entries.map(([, d]) => round2(d.amount)), backgroundColor: p.warn, borderRadius: 4 }]
      },
      options: baseOptions(isDark)
    };
  }

  /* 6. Discount Analysis (split: items with vs without discount) */
  function discountAnalysisConfig(state, isDark) {
    const p = palette(isDark);
    const withDisc = state.discountAnalysis.itemsWithDiscount;
    const without = state.rows.length - withDisc;
    return {
      type: 'pie',
      data: {
        labels: ['Items With Discount', 'Items Without Discount'],
        datasets: [{ data: [withDisc, without], backgroundColor: [p.secondary, p.grid], borderWidth: 2, borderColor: isDark ? '#141b2d' : '#ffffff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: p.text } } } }
    };
  }

  /* 7. Top 10 Highest Cost Items (bar) */
  function top10CostItemsConfig(state, isDark) {
    const p = palette(isDark);
    const top = state.itemAnalysis.slice(0, 10);
    return {
      type: 'bar',
      data: {
        labels: top.map(i => truncate(i.itemDescription, 16)),
        fullValues: top.map(i => i.itemDescription),
        datasets: [{ label: 'Total Value', data: top.map(i => i.totalPurchaseValue), backgroundColor: p.danger, borderRadius: 4 }]
      },
      options: baseOptions(isDark)
    };
  }

  /* 8. Top 10 Frequently Purchased Items (bar) */
  function top10FrequentItemsConfig(state, isDark) {
    const p = palette(isDark);
    const top = state.itemAnalysis.slice().sort((a, b) => b.purchaseFrequency - a.purchaseFrequency).slice(0, 10);
    return {
      type: 'bar',
      data: {
        labels: top.map(i => truncate(i.itemDescription, 16)),
        fullValues: top.map(i => i.itemDescription),
        datasets: [{ label: 'Times Purchased', data: top.map(i => i.purchaseFrequency), backgroundColor: p.primaryLight, borderRadius: 4 }]
      },
      options: baseOptions(isDark)
    };
  }

  /* 9. Unit Rate Trend (multi-line for top N duplicate items across time) */
  function unitRateTrendConfig(state, isDark) {
    const p = palette(isDark);
    const dupItems = state.itemAnalysis.filter(i => i.isDuplicate).slice(0, 5);
    const allDates = Array.from(new Set(
      dupItems.flatMap(i => i.records.map(r => r.poDate)).filter(Boolean)
    )).sort();
    const datasets = dupItems.map((item, idx) => {
      const rateByDate = {};
      item.records.forEach(r => { if (r.poDate) rateByDate[r.poDate] = r.unitRate; });
      return {
        label: truncate(item.itemDescription, 20),
        data: allDates.map(d => rateByDate[d] !== undefined ? rateByDate[d] : null),
        borderColor: p.series[idx % p.series.length],
        backgroundColor: 'transparent',
        spanGaps: true, tension: 0.3, pointRadius: 3
      };
    });
    return {
      type: 'line',
      data: { labels: allDates, datasets },
      options: baseOptions(isDark)
    };
  }

  /* 10. Purchase Value by Financial Year (bar) */
  function fyWiseConfig(state, isDark) {
    const p = palette(isDark);
    const entries = Object.entries(state.fyTotals).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      type: 'bar',
      data: {
        labels: entries.map(([fy]) => fy),
        fullValues: entries.map(([fy]) => fy),
        datasets: [{ label: 'Purchase Value', data: entries.map(([, v]) => round2(v)), backgroundColor: p.primary, borderRadius: 6 }]
      },
      options: baseOptions(isDark)
    };
  }

  function hexAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function truncate(str, max) { return str && str.length > max ? str.slice(0, max - 1) + '…' : (str || ''); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  global.POCharts = {
    monthlyTrendConfig, vendorWiseConfig, itemWiseConfig, categoryWiseConfig, taxAnalysisConfig,
    discountAnalysisConfig, top10CostItemsConfig, top10FrequentItemsConfig, unitRateTrendConfig, fyWiseConfig,
    palette
  };
})(typeof window !== 'undefined' ? window : globalThis);
