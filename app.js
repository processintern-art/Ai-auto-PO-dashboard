/* ============================================================
   AI Auto PO Dashboard — Live Dashboard Controller
   Production live-data mode: no upload UI. On every page load /
   refresh, fetches the configured Google Sheets CSV export and
   pipes it straight through: parsing (SheetJS) -> PODataCore
   (mapping + aggregation + insights) -> POCharts + all export
   modules. The dashboard view is the only entry point.
   ============================================================ */
(function () {
  'use strict';

  // The single configured data source for this deployment: a published
  // Google Sheet, exported live as CSV. Every page load/refresh re-fetches
  // this URL, so the dashboard always reflects the latest sheet contents.
  // Swap this one constant to point the whole app at a different sheet.
  const DEFAULT_CSV_URL = https://docs.google.com/spreadsheets/d/e/2PACX-1vRv8dr4rGk_3ObJlWVApNBFEbUnvs8mjlQ6XZ4yUkD-3N5MqFjUPhlTdZ8_fyWdSrEJ55QEVSU8Yc4r/pub?gid=1370315691&single=true&output=csv

  const App = {
    workbook: null,          // raw SheetJS workbook
    sheetNames: [],
    activeSheet: null,
    rawHeaders: [],
    rawRows: [],             // full parsed rows (array of arrays) for active sheet
    state: null,             // output of PODataCore.processDataset
    filteredRows: null,      // rows after filters applied (subset of state.rows)
    derivedState: null,      // recomputed kpis/charts on filtered rows
    chartInstances: {},
    isDark: false,
    sortCol: null,
    sortDir: 1,
    searchTerm: '',
    // Tracks active chart-driven drill-down filters, in the order they were
    // applied, so the breadcrumb UI can show "Vendor: Acme Corp > Item: Steel Rod"
    // and let the user remove the most recent one (or all of them) without
    // disturbing the regular filter-bar dropdowns, which remain independent.
    drillPath: []
  };

  /* ---------------- Init ---------------- */
  // Wait for the multi-CDN library loader (lib-loader.js) to confirm every
  // external dependency (XLSX, Chart, jsPDF, autoTable, PptxGenJS) actually
  // registered its global before wiring up any UI. This is what prevents
  // "Chart is not defined" / "XLSX is not defined" style errors if a script
  // tag is still mid-flight (or failed) when the user interacts with the page.
  document.addEventListener('DOMContentLoaded', () => {
    const ready = window.POLibsReady || Promise.resolve(true);
    ready.then(() => {
      initTheme();
      initSidebar();
      initExportMenu();
      initTableControls();
      initWhyModal();
      initLiveClock();
      loadLiveDashboard();
    }).catch(err => {
      // lib-loader.js already shows an in-page error banner in this case;
      // log for diagnostics but don't double-report to the user here.
      console.error('App init aborted — required library failed to load:', err);
    });
  });

  function initTheme() {
    const saved = null; // never use localStorage in this environment; default to light each load
    App.isDark = false;
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggle').addEventListener('click', () => {
      App.isDark = !App.isDark;
      document.documentElement.setAttribute('data-theme', App.isDark ? 'dark' : 'light');
      if (!App.isDark) document.documentElement.removeAttribute('data-theme');
      updateThemeIcon();
      if (App.state) renderAllCharts();
    });
    updateThemeIcon();
  }
  function updateThemeIcon() {
    document.getElementById('themeIconSun').style.display = App.isDark ? 'none' : 'block';
    document.getElementById('themeIconMoon').style.display = App.isDark ? 'block' : 'none';
  }

  function initSidebar() {
    const links = document.querySelectorAll('.sidebar-link[data-view]');
    links.forEach(link => {
      link.addEventListener('click', () => {
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        showView(link.dataset.view);
      });
    });
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarOverlay').classList.toggle('show');
    });
    document.getElementById('sidebarOverlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('show');
    });
  }

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('active');
    document.getElementById('topbarTitleText').textContent = viewTitle(viewName);
    document.body.classList.toggle('is-dashboard-view', viewName === 'dashboard');
  }
  function viewTitle(v) {
    return {
      dashboard: 'Dashboard Overview', charts: 'Charts & Analytics',
      items: 'Item Analysis', vendors: 'Vendor Analysis', insights: 'AI Insights',
      data: 'Data Table', scorecard: 'Vendor Scorecard', savings: 'Savings Opportunity',
      recommendations: 'Smart Recommendations', alerts: 'Smart Alerts'
    }[v] || 'Dashboard';
  }

  /* ---------------- Live Date & Time widget ---------------- */
  const CLOCK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CLOCK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function initLiveClock() {
    const dateEl = document.getElementById('liveClockDate');
    const timeEl = document.getElementById('liveClockTime');
    if (!dateEl || !timeEl) return;

    // Dashboard is the default landing view, so show the widget immediately;
    // showView() keeps this class in sync on every subsequent navigation.
    document.body.classList.add('is-dashboard-view');

    const pad2 = (n) => String(n).padStart(2, '0');

    function renderClock() {
      // new Date() always reflects the browser's local timezone — no
      // timezone conversion needed. Re-reading it fresh every tick is also
      // what makes the date line roll over automatically at midnight.
      const now = new Date();
      dateEl.textContent = `${CLOCK_WEEKDAYS[now.getDay()]}, ${pad2(now.getDate())} ${CLOCK_MONTHS[now.getMonth()]}, ${now.getFullYear()}`;

      let hours = now.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      timeEl.textContent = `${pad2(hours)}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} ${ampm}`;
    }

    renderClock();
    setInterval(renderClock, 1000);
  }

  /* ---------------- Live data load ---------------- */
  /**
   * The entire data pipeline for this production build: fetch the
   * configured Google Sheets CSV export, parse it, and generate the full
   * dashboard — no upload, no manual URL entry, no confirmation click.
   * Runs once per page load, so every browser refresh re-fetches the
   * latest sheet contents.
   */
  function loadLiveDashboard() {
    showLoadingOverlay('Fetching live data…');
    fetch(DEFAULT_CSV_URL)
      .then(res => { if (!res.ok) throw new Error('fetch failed'); return res.text(); })
      .then(csvText => {
        const wb = XLSX.read(csvText, { type: 'string' });
        App.workbook = wb;
        App.sheetNames = wb.SheetNames;
        loadSheet(wb.SheetNames[0]);
        generateDashboard();
      })
      .catch(() => {
        showLoadingOverlay('Could not load the live data source. Make sure the sheet is published and shared as "Anyone with the link can view", then refresh.', true);
      });
  }

  function loadSheet(sheetName) {
    App.activeSheet = sheetName;
    const ws = App.workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const { headerRowIdx, headers } = detectHeaderRow(aoa);
    App.rawHeaders = headers;
    App.rawRows = aoa.slice(headerRowIdx + 1);
  }

  /**
   * Auto-detect the header row: scan the first ~10 rows, score each by
   * "text-density + non-empty cell count", pick the best candidate.
   * Handles sheets where titles/blank rows precede the real header.
   */
  function detectHeaderRow(aoa) {
    const scanLimit = Math.min(10, aoa.length);
    let best = { idx: 0, score: -1 };
    for (let i = 0; i < scanLimit; i++) {
      const row = aoa[i] || [];
      const nonEmpty = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
      if (nonEmpty.length < 2) continue;
      const textCells = nonEmpty.filter(c => typeof c === 'string' && isNaN(Number(c)));
      const uniqueRatio = new Set(nonEmpty.map(String)).size / nonEmpty.length;
      const score = textCells.length * 2 + nonEmpty.length + uniqueRatio * 3;
      // Next row should look like data (more cells filled, ideally some numeric)
      const nextRow = aoa[i + 1] || [];
      const nextNonEmpty = nextRow.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
      const bonus = nextNonEmpty.length >= nonEmpty.length * 0.6 ? 2 : 0;
      const total = score + bonus;
      if (total > best.score) best = { idx: i, score: total };
    }
    const headerRow = aoa[best.idx] || [];
    const headers = headerRow.map((h, idx) => (h !== null && h !== undefined && String(h).trim() !== '') ? String(h).trim() : `Column ${idx + 1}`);
    return { headerRowIdx: best.idx, headers };
  }

  // Threshold above which we prefer the Web Worker path even if it's
  // available, vs. just running synchronously for small files (worker
  // setup/postMessage overhead isn't worth it for a 50-row file).
  const WORKER_ROW_THRESHOLD = 2000;

  function generateDashboard() {
    showLoadingOverlay('Generating dashboard…');
    const rowCount = App.rawRows.length;
    const useWorker = rowCount >= WORKER_ROW_THRESHOLD && typeof Worker !== 'undefined';

    if (useWorker) {
      runProcessingInWorker();
    } else {
      // Small file, or Workers unsupported/unavailable (e.g. some browsers
      // restrict Worker script loading when the page is opened via file://
      // rather than served over http/https) — fall back to the original
      // synchronous path so the app still works either way.
      setTimeout(runProcessingSync, 50);
    }
  }

  function runProcessingSync() {
    try {
      App.state = PODataCore.processDataset(App.rawHeaders, App.rawRows);
      // Run all new analysis engines (same as the Worker path, but synchronous)
      if (typeof POSavingsAnalysis !== 'undefined') {
        App.state.savingsResult = POSavingsAnalysis.analyzeSavings(App.state.itemAnalysis);
      }
      if (typeof POVendorScorecard !== 'undefined') {
        App.state.scorecards = POVendorScorecard.buildVendorScorecards(App.state.rows, App.state.itemAnalysis, App.state.vendorTotals);
      }
      if (typeof PORecommendations !== 'undefined' && App.state.scorecards) {
        App.state.recommendations = PORecommendations.generateRecommendations({
          itemAnalysis: App.state.itemAnalysis, scorecards: App.state.scorecards,
          savingsResult: App.state.savingsResult, vendorTotals: App.state.vendorTotals
        });
      }
      if (typeof POSmartAlerts !== 'undefined') {
        App.state.alerts = POSmartAlerts.generateAlerts({
          rows: App.state.rows, itemAnalysis: App.state.itemAnalysis,
          vendorTotals: App.state.vendorTotals, taxByRate: App.state.taxByRate,
          discountAnalysis: App.state.discountAnalysis, totalPurchaseValue: App.state.kpis.totalPurchaseValue
        });
      }
      finishDashboardGeneration();
    } catch (err) {
      console.error(err);
      showLoadingOverlay('Something went wrong generating the dashboard. Please refresh to retry.', true);
    }
  }

  function runProcessingInWorker() {
    let worker;
    try {
      worker = new Worker('data-worker.js');
    } catch (err) {
      // Worker construction itself can throw synchronously in restrictive
      // environments (e.g. file:// in some browsers) — fall back immediately.
      console.warn('Web Worker unavailable, falling back to synchronous processing:', err);
      setTimeout(runProcessingSync, 50);
      return;
    }

    let settled = false;
    // Safety timeout: if the worker never responds (e.g. importScripts
    // silently failed in some edge-case browser/security configuration),
    // don't leave the user stuck on "Generating…" forever — fall back.
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('Worker timed out, falling back to synchronous processing');
      worker.terminate();
      runProcessingSync();
    }, 30000);

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        updateLoadingOverlay(msg.stage);
      } else if (msg.type === 'done') {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        worker.terminate();
        App.state = msg.state;
        finishDashboardGeneration();
      } else if (msg.type === 'error') {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        worker.terminate();
        console.error('Worker processing error:', msg.message);
        showLoadingOverlay('Something went wrong generating the dashboard. Please refresh to retry.', true);
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      console.warn('Worker errored, falling back to synchronous processing:', err.message);
      runProcessingSync();
    };

    worker.postMessage({ type: 'process', headers: App.rawHeaders, rows: App.rawRows });
  }

  function finishDashboardGeneration() {
    if (!App.state.rows.length) {
      showLoadingOverlay('No usable data rows found in the connected sheet.', true);
      return;
    }
    App.filteredRows = App.state.rows.slice();
    populateFilters();
    applyFiltersAndRender();
    hideLoadingOverlay();
    showToast('Live dashboard loaded', 'success');
  }

  /**
   * Full-page overlay shown while the live sheet is fetched/parsed/processed
   * on every page load, since the dashboard is now the only view — there's
   * no upload screen underneath it to show instead.
   */
  function showLoadingOverlay(message, isError) {
    const overlay = document.getElementById('dashboardLoadingOverlay');
    const text = document.getElementById('dashboardLoadingText');
    const spinner = document.getElementById('dashboardLoadingSpinner');
    overlay.style.display = 'flex';
    text.textContent = message;
    spinner.style.display = isError ? 'none' : 'block';
    text.style.color = isError ? 'var(--red, #dc2626)' : '';
  }
  function updateLoadingOverlay(message) {
    document.getElementById('dashboardLoadingText').textContent = message;
  }
  function hideLoadingOverlay() {
    document.getElementById('dashboardLoadingOverlay').style.display = 'none';
  }

  /* ---------------- Filters ---------------- */
  function populateFilters() {
    const rows = App.state.rows;
    fillSelect('filterFY', uniqueSorted(rows.map(r => r.financialYear)));
    fillSelect('filterVendor', uniqueSorted(rows.map(r => r.vendorName)));
    fillSelect('filterItem', uniqueSorted(rows.map(r => r.itemDescription)));
    fillSelect('filterCategory', uniqueSorted(rows.map(r => r.category)));
    fillSelect('filterTaxRate', uniqueSorted(rows.map(r => r.taxRate != null ? String(r.taxRate) + '%' : null)));
    fillSelect('filterPO', uniqueSorted(rows.map(r => r.poNumber)));
    fillSelect('filterRaisedBy', uniqueSorted(rows.map(r => r.poRaisedBy)));

    ['filterFY','filterVendor','filterItem','filterCategory','filterTaxRate','filterPO','filterRaisedBy','filterDateFrom','filterDateTo']
      .forEach(id => document.getElementById(id).addEventListener('change', () => {
        syncDrillPathWithFilterEl(id);
        deferredApplyFiltersAndRender();
      }));
    document.getElementById('filterClear').addEventListener('click', clearFilters);
  }

  /**
   * Wraps applyFiltersAndRender with a brief loading indicator + a one-frame
   * defer, so on large datasets the browser gets a chance to actually paint
   * the "Filtering…" state before the synchronous aggregation work runs.
   * This doesn't make the work itself faster, but it avoids the filter
   * dropdown visually "sticking" with no feedback while the page is busy —
   * the dominant cost (full-dataset processing) already happens once in a
   * Web Worker at upload time; this covers the smaller remaining synchronous
   * cost of recomputing aggregates for an actively-filtered subset.
   */
  function deferredApplyFiltersAndRender() {
    const indicator = document.getElementById('filterBusyIndicator');
    if (indicator) indicator.style.display = 'inline-flex';
    requestAnimationFrame(() => {
      setTimeout(() => {
        applyFiltersAndRender();
        if (indicator) indicator.style.display = 'none';
      }, 0);
    });
  }

  /**
   * Keeps the drill-down breadcrumb honest when a filter dropdown is changed
   * directly by the user (rather than via a chart click): if that dropdown
   * backs an active breadcrumb level, either update the chip to the new
   * value or remove it (and anything drilled deeper) if the dropdown was
   * cleared to "All".
   */
  function syncDrillPathWithFilterEl(filterElId) {
    const idx = App.drillPath.findIndex(d => d.filterElId === filterElId);
    if (idx === -1) return;
    const newValue = document.getElementById(filterElId).value;
    if (!newValue) {
      App.drillPath.splice(idx);
    } else {
      App.drillPath[idx].value = newValue;
      App.drillPath.splice(idx + 1); // deeper levels were drilled against the old value; no longer valid
    }
    renderDrillBreadcrumb();
  }
  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  }
  function fillSelect(id, values) {
    const sel = document.getElementById(id);
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>' + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (values.includes(current)) sel.value = current;
  }
  function clearFilters() {
    ['filterFY','filterVendor','filterItem','filterCategory','filterTaxRate','filterPO','filterRaisedBy'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    App.drillPath = [];
    renderDrillBreadcrumb();
    applyFiltersAndRender();
  }

  function applyFiltersAndRender() {
    const fy = document.getElementById('filterFY').value;
    const vendor = document.getElementById('filterVendor').value;
    const item = document.getElementById('filterItem').value;
    const category = document.getElementById('filterCategory').value;
    const taxRate = document.getElementById('filterTaxRate').value;
    const po = document.getElementById('filterPO').value;
    const raisedBy = document.getElementById('filterRaisedBy').value;
    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;

    const noFiltersActive = !fy && !vendor && !item && !category && !taxRate && !po && !raisedBy && !dateFrom && !dateTo;

    if (noFiltersActive) {
      // Fast path: nothing is filtered, so the result is identical to the
      // already-computed App.state — reuse it directly rather than redoing
      // the full aggregation pass. This is what keeps "Clear Filters" (and
      // the default state right after upload) instant even on very large
      // datasets, where recomputing from scratch could take over a second.
      App.filteredRows = App.state.rows;
      App.derivedState = App.state;
    } else {
      App.filteredRows = App.state.rows.filter(r => {
        if (fy && r.financialYear !== fy) return false;
        if (vendor && r.vendorName !== vendor) return false;
        if (item && r.itemDescription !== item) return false;
        if (category && r.category !== category) return false;
        if (taxRate && (r.taxRate != null ? String(r.taxRate) + '%' : '') !== taxRate) return false;
        if (po && r.poNumber !== po) return false;
        if (raisedBy && r.poRaisedBy !== raisedBy) return false;
        if (dateFrom && r.poDate && r.poDate < dateFrom) return false;
        if (dateTo && r.poDate && r.poDate > dateTo) return false;
        return true;
      });
      App.derivedState = recomputeFromRows(App.filteredRows);
    }
    renderKpis();
    renderInsights();
    renderAllCharts();
    renderItemTable();
    renderVendorTable();
    renderDataTable();
    // New features — use App.state (not derivedState) for features that don't
    // change on every filter (savings, scorecards, recommendations, alerts are
    // computed once at upload time and shown from full-dataset perspective)
    renderExecutiveSummary();
    renderSmartAlerts();
    renderSavingsPanel();
    renderRecommendations();
    renderScorecardTable();
  }

  /**
   * Recompute KPIs/aggregations for a filtered row subset by reusing
   * PODataCore's aggregation logic (kept consistent with the full pipeline).
   */
  function recomputeFromRows(rows) {
    // Delegates to the same aggregation logic processDataset() uses internally,
    // so filtering can never drift out of sync with the initial full-dataset
    // computation (PO-level rollup, line-item filtering, category case-folding,
    // executive-summary totals, etc. all stay identical in both code paths).
    return PODataCore.computeAggregates(rows);
  }

  /* ---------------- Rendering: KPIs ---------------- */
  function renderKpis() {
    const k = App.derivedState.kpis;
    setKpi('kpiTotalValue', formatMoney(k.totalPurchaseValue));
    setKpi('kpiTotalPO', k.totalPOs.toLocaleString('en-IN'));
    setKpi('kpiTotalVendors', k.totalVendors.toLocaleString('en-IN'));
    setKpi('kpiTotalItems', k.totalItems.toLocaleString('en-IN'));
    setKpi('kpiAvgRate', formatMoney(k.avgUnitRate));
    setKpi('kpiHighestItem', k.highestItem ? truncateText(k.highestItem.itemDescription, 22) : '—');
    document.getElementById('kpiHighestItemSub').textContent = k.highestItem ? formatMoney(k.highestItem.totalPurchaseValue) : '';
    // Savings KPI — always from full dataset (App.state, not filtered derivedState)
    const savings = App.state && App.state.savingsResult ? App.state.savingsResult.totalPotentialSavings : 0;
    setKpi('kpiPotentialSavings', formatMoney(savings));
  }
  function setKpi(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ---------------- Rendering: Insights ---------------- */
  const ICONS = {
    trophy: '<path d="M7 4h10v3a5 5 0 01-5 5 5 5 0 01-5-5V4z"/><path d="M7 4H4a1 1 0 00-1 1v1a3 3 0 003 3"/><path d="M17 4h3a1 1 0 011 1v1a3 3 0 01-3 3"/><path d="M9 17h6"/><path d="M12 12v5"/><path d="M8 20h8"/>',
    repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'piggy-bank': '<path d="M19 5c-1.5-1.5-3.5-2-5.5-2-4 0-7.5 3-7.5 7 0 1 .2 2 .5 3l-2 2v3h3l2 2h4l1-1h2l1 1h1v-4c1-1 1.5-2.5 1.5-4"/><circle cx="9" cy="11" r="1"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    scale: '<path d="M12 3v18"/><path d="M5 7l-3 6a3 3 0 006 0z"/><path d="M19 7l-3 6a3 3 0 006 0z"/><path d="M5 7h14"/><path d="M9 21h6"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    receipt: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
    'user-minus': '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/>',
    'file-text': '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>'
  };
  function iconSvg(name, size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS['file-text']}</svg>`;
  }

  function renderInsights() {
    const wrap = document.getElementById('insightsScroll');
    wrap.innerHTML = '';
    App.derivedState.insights.forEach(ins => {
      const card = document.createElement('div');
      card.className = 'insight-card';
      card.innerHTML = `<div class="insight-card-title">${iconSvg(ins.icon, 14)} ${escapeHtml(ins.title)}</div><div class="insight-card-text">${escapeHtml(ins.text)}</div>`;
      wrap.appendChild(card);
    });
    // Mirror into the dedicated Insights view as a full list
    const fullWrap = document.getElementById('insightsFullList');
    fullWrap.innerHTML = '';
    App.derivedState.insights.forEach(ins => {
      const card = document.createElement('div');
      card.className = 'insight-card';
      card.style.flex = '1 1 320px';
      card.innerHTML = `<div class="insight-card-title">${iconSvg(ins.icon, 14)} ${escapeHtml(ins.title)}</div><div class="insight-card-text">${escapeHtml(ins.text)}</div>`;
      fullWrap.appendChild(card);
    });
  }

  /* ---------------- Rendering: Charts ---------------- */
  const CHART_DEFS = [
    { id: 'chartMonthlyTrend', fn: 'monthlyTrendConfig' }, // time-series; not a categorical drill target
    { id: 'chartVendorWise', fn: 'vendorWiseConfig', drillField: 'vendorName', filterEl: 'filterVendor', drillLabel: 'Vendor' },
    { id: 'chartItemWise', fn: 'itemWiseConfig', drillField: 'itemDescription', filterEl: 'filterItem', drillLabel: 'Item' },
    { id: 'chartCategoryWise', fn: 'categoryWiseConfig', drillField: 'category', filterEl: 'filterCategory', drillLabel: 'Category' },
    { id: 'chartTaxAnalysis', fn: 'taxAnalysisConfig' },
    { id: 'chartDiscountAnalysis', fn: 'discountAnalysisConfig' },
    { id: 'chartTop10Cost', fn: 'top10CostItemsConfig', drillField: 'itemDescription', filterEl: 'filterItem', drillLabel: 'Item' },
    { id: 'chartTop10Frequent', fn: 'top10FrequentItemsConfig', drillField: 'itemDescription', filterEl: 'filterItem', drillLabel: 'Item' },
    { id: 'chartUnitRateTrend', fn: 'unitRateTrendConfig' }, // multi-line trend; not a single categorical drill target
    { id: 'chartFYWise', fn: 'fyWiseConfig', drillField: 'financialYear', filterEl: 'filterFY', drillLabel: 'Year' }
  ];

  function renderAllCharts() {
    if (!App.derivedState) return;
    CHART_DEFS.forEach(def => {
      const canvas = document.getElementById(def.id);
      if (!canvas) return;
      if (App.chartInstances[def.id]) App.chartInstances[def.id].destroy();
      const cfg = POCharts[def.fn](App.derivedState, App.isDark);

      if (def.drillField) {
        // Make the cursor a pointer over clickable data points, and wire the
        // click handler. Chart.js's own onClick option receives the click
        // event plus the clicked element(s); we resolve the element's data
        // index back to the chart's `fullValues` array (the untruncated
        // version of the label) rather than trusting the truncated display
        // label, which can collide or fail to match the real filter value.
        cfg.options = cfg.options || {};
        cfg.options.onHover = (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; };
        cfg.options.onClick = (evt, elements, chart) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const fullValues = chart.data.fullValues;
          const value = fullValues ? fullValues[idx] : chart.data.labels[idx];
          if (value === undefined || value === null) return;
          applyDrillDown(def.drillField, def.filterEl, def.drillLabel, value);
        };
      }

      App.chartInstances[def.id] = new Chart(canvas.getContext('2d'), cfg);
    });
  }

  /**
   * Applies a drill-down filter triggered by clicking a chart data point.
   * Sets the corresponding filter-bar dropdown to the clicked value (so the
   * regular filter UI and drill-downs stay in sync and either can clear the
   * other), records it on the breadcrumb path, and re-renders the dashboard
   * through the existing filter pipeline — so drill-down is just a
   * programmatic shortcut for "set this filter," not a separate code path
   * that could drift out of sync with manual filtering.
   */
  function applyDrillDown(field, filterElId, label, value) {
    const sel = document.getElementById(filterElId);
    if (sel) {
      // Guard against drilling into a value not present in the dropdown's
      // current option list (can happen if a previous drill already
      // narrowed the dataset) — in that case just skip rather than setting
      // an invalid/no-op value.
      const hasOption = Array.from(sel.options).some(o => o.value === value);
      if (!hasOption) return;
      sel.value = value;
    }
    // Replace any existing breadcrumb entry for the same field (clicking a
    // different bar in the same chart should update, not stack, that level)
    App.drillPath = App.drillPath.filter(d => d.field !== field);
    App.drillPath.push({ field, filterElId, label, value });
    renderDrillBreadcrumb();
    applyFiltersAndRender();
  }

  function clearDrillLevel(index) {
    // Clear this breadcrumb entry and everything after it (drilling is
    // hierarchical — removing an earlier level invalidates later ones,
    // since later clicks were made against the narrower, already-filtered
    // chart data).
    const removed = App.drillPath.splice(index);
    removed.forEach(d => {
      const sel = document.getElementById(d.filterElId);
      if (sel) sel.value = '';
    });
    renderDrillBreadcrumb();
    applyFiltersAndRender();
  }

  function renderDrillBreadcrumb() {
    const wrap = document.getElementById('drillBreadcrumb');
    if (!wrap) return;
    if (!App.drillPath.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = `<span class="drill-label">Drilled into:</span>` +
      App.drillPath.map((d, i) =>
        `<span class="drill-chip">${escapeHtml(d.label)}: <strong>${escapeHtml(truncateText(String(d.value), 28))}</strong>
           <button class="drill-chip-x" data-drill-index="${i}" title="Remove this and deeper levels" type="button">&times;</button>
         </span>`
      ).join('<span class="drill-sep">›</span>') +
      `<button class="btn btn-outline btn-sm drill-clear-all" id="drillClearAll" type="button">Clear All</button>`;

    wrap.querySelectorAll('[data-drill-index]').forEach(btn => {
      btn.addEventListener('click', () => clearDrillLevel(parseInt(btn.dataset.drillIndex, 10)));
    });
    const clearAllBtn = document.getElementById('drillClearAll');
    if (clearAllBtn) clearAllBtn.addEventListener('click', () => clearDrillLevel(0));
  }

  /* ---------------- Rendering: Item table ---------------- */
  function renderVendorTable() {
    const tbody = document.getElementById('vendorTableBody');
    tbody.innerHTML = '';
    Object.entries(App.derivedState.vendorTotals).sort((a, b) => b[1].total - a[1].total).forEach(([name, d]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td class="tabular">${formatMoney(d.total)}</td>
        <td class="tabular">${d.poCount}</td>
        <td class="tabular">${d.items.size}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* ================================================================
     NEW FEATURES: Executive Summary, Smart Alerts, Savings,
     Recommendations, Vendor Scorecard, Why? Modal
     ================================================================ */

  function renderExecutiveSummary() {
    const el = document.getElementById('executiveSummaryCard');
    if (!el || !App.state) return;
    const k = App.state.kpis;
    const dup = App.state.itemAnalysis.filter(i => i.isDuplicate);
    const rising = App.state.itemAnalysis.filter(i => i.trend === 'increasing' && i.purchaseFrequency > 1);
    const savings = App.state.savingsResult ? App.state.savingsResult.totalPotentialSavings : 0;
    const stableVendors = (App.state.scorecards || []).filter(c => c.priceStability >= 80).length;
    el.innerHTML = `
      <div class="exec-summary-grid">
        <div class="exec-item"><span class="exec-num">${k.totalPOs}</span><span class="exec-label">Purchase Orders</span></div>
        <div class="exec-item"><span class="exec-num">${k.totalVendors}</span><span class="exec-label">Vendors</span></div>
        <div class="exec-item"><span class="exec-num">${k.totalItems}</span><span class="exec-label">Distinct Items</span></div>
        <div class="exec-item"><span class="exec-num">${dup.length}</span><span class="exec-label">Duplicate Items</span></div>
        <div class="exec-item exec-highlight"><span class="exec-num">${formatMoney(savings)}</span><span class="exec-label">Potential Savings</span></div>
        <div class="exec-item${rising.length ? ' exec-warn' : ''}"><span class="exec-num">${rising.length}</span><span class="exec-label">Rising Price Items</span></div>
        <div class="exec-item exec-positive"><span class="exec-num">${stableVendors}</span><span class="exec-label">Stable Vendors</span></div>
        <div class="exec-item"><span class="exec-num">${formatMoney(k.totalPurchaseValue)}</span><span class="exec-label">Total Spend</span></div>
      </div>
    `;
  }

  function renderSmartAlerts() {
    const alerts = (App.state && App.state.alerts) || [];
    const iconMap = {
      'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
      package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>',
      copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
      receipt: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
      truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
      shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>',
      'user-minus': '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/>'
    };
    function alertIcon(name) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMap[name] || ''}</svg>`;
    }
    const fullHtml = alerts.length
      ? alerts.map(a => `
          <div class="alert-card alert-${escapeHtml(a.severity)}">
            <div class="alert-icon">${alertIcon(a.icon)}</div>
            <div class="alert-body">
              <div class="alert-title">${escapeHtml(a.title)}</div>
              <div class="alert-text">${escapeHtml(a.body)}</div>
            </div>
            <div class="alert-value">${escapeHtml(a.value)}</div>
          </div>`).join('')
      : '<div class="empty-state" style="padding:20px;font-size:13px;color:var(--text-muted);">No alerts for this dataset.</div>';

    // Full alerts view
    const wrap = document.getElementById('smartAlertsWrap');
    if (wrap) wrap.innerHTML = fullHtml;

    // Compact dashboard strip — show warning-severity alerts only (max 3)
    const strip = document.getElementById('dashboardAlertsStrip');
    if (strip) {
      const dashAlerts = alerts.filter(a => a.severity === 'warning').slice(0, 3);
      strip.innerHTML = dashAlerts.length
        ? `<div class="section-title" style="margin-bottom:10px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg> Smart Alerts</div>`
          + dashAlerts.map(a => `
          <div class="alert-card alert-${escapeHtml(a.severity)}">
            <div class="alert-icon">${alertIcon(a.icon)}</div>
            <div class="alert-body">
              <div class="alert-title">${escapeHtml(a.title)}</div>
              <div class="alert-text">${escapeHtml(a.body)}</div>
            </div>
            <div class="alert-value">${escapeHtml(a.value)}</div>
          </div>`).join('')
        : '';
    }
  }

  function renderSavingsPanel() {
    const wrap = document.getElementById('savingsPanelWrap');
    if (!wrap) return;
    const savings = (App.state && App.state.savingsResult) || { items: [], totalPotentialSavings: 0 };
    if (!savings.items.length) {
      wrap.innerHTML = '<div class="empty-state" style="padding:20px;font-size:13px;color:var(--text-muted);">No savings opportunities detected — all duplicate items were purchased at identical rates.</div>';
      return;
    }
    wrap.innerHTML = savings.items.map(s => `
      <div class="savings-card">
        <div class="savings-item-name">${escapeHtml(s.itemDescription)}</div>
        <div class="savings-mode-badge">${s.mode === 'multi-vendor' ? 'Cross-Vendor' : 'Rate Volatility'}</div>
        <div class="savings-body">${escapeHtml(s.text)}</div>
        <div class="savings-amount">${formatMoney(s.potentialSavings)}</div>
      </div>
    `).join('');
  }

  function renderRecommendations() {
    const wrap = document.getElementById('recommendationsWrap');
    if (!wrap) return;
    const recs = (App.state && App.state.recommendations) || [];
    if (!recs.length) { wrap.innerHTML = '<div class="empty-state" style="padding:20px;font-size:13px;color:var(--text-muted);">No recommendations yet — upload a file to generate them.</div>'; return; }
    const recIconMap = {
      award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>',
      'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
      'piggy-bank': '<path d="M19 5c-1.5-1.5-3.5-2-5.5-2-4 0-7.5 3-7.5 7 0 1 .2 2 .5 3l-2 2v3h3l2 2h4l1-1h2l1 1h1v-4c1-1 1.5-2.5 1.5-4"/><circle cx="9" cy="11" r="1"/>',
      'git-merge': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/>',
      'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
    };
    function recIcon(name) {
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${recIconMap[name] || ''}</svg>`;
    }
    wrap.innerHTML = recs.map(r => `
      <div class="rec-card">
        <div class="rec-icon">${recIcon(r.icon)}</div>
        <div class="rec-body">
          <div class="rec-title">${escapeHtml(r.title)}</div>
          <div class="rec-text">${escapeHtml(r.body)}</div>
        </div>
        <div class="rec-metric-block">
          <div class="rec-metric">${escapeHtml(r.metric)}</div>
          <div class="rec-metric-label">${escapeHtml(r.metricLabel)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderScorecardTable() {
    const tbody = document.getElementById('scorecardTableBody');
    if (!tbody) return;
    const cards = (App.state && App.state.scorecards) || [];
    tbody.innerHTML = '';
    cards.forEach(c => {
      const scoreColor = c.overallScore >= 70 ? 'var(--teal)' : c.overallScore >= 50 ? 'var(--amber)' : 'var(--rose)';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(c.vendorName)}</td>
        <td class="tabular">${formatMoney(c.avgUnitRate)}</td>
        <td class="tabular">${formatMoney(c.totalSpend)}</td>
        <td class="tabular">${c.purchaseCount}</td>
        <td class="tabular">
          <div class="score-bar-wrap">
            <div class="score-bar" style="width:${c.priceStability}%;background:${c.priceStability >= 80 ? 'var(--teal)' : c.priceStability >= 50 ? 'var(--amber)' : 'var(--rose)'}"></div>
            <span>${c.priceStability}</span>
          </div>
        </td>
        <td>${c.duplicateItems ? '<span class="dup-badge">YES</span>' : '<span style="color:var(--text-faint)">No</span>'}</td>
        <td class="tabular" style="font-weight:800;color:${scoreColor}">${c.overallScore}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* ----------------------------------------------------------------
     WHY? MODAL — #3 in spec
     Opens when user clicks [Why?] on a duplicate item row, shows
     the two (or more) purchase records side-by-side and displays
     the AI-generated root-cause conclusion with confidence score.
     ---------------------------------------------------------------- */
  function initWhyModal() {
    const overlay = document.getElementById('whyModalOverlay');
    const closeBtn = document.getElementById('whyModalClose');
    if (!overlay) return;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWhyModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeWhyModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWhyModal(); });
  }
  function closeWhyModal() {
    const overlay = document.getElementById('whyModalOverlay');
    if (overlay) overlay.classList.remove('open');
  }
  function openWhyModal(item) {
    const overlay = document.getElementById('whyModalOverlay');
    const title = document.getElementById('whyModalItemTitle');
    const body = document.getElementById('whyModalBody');
    if (!overlay || !body) return;

    if (title) title.textContent = item.itemDescription;
    const analysis = item.priceAnalysis;
    if (!analysis || !analysis.consecutive.length) {
      body.innerHTML = '<p style="color:var(--text-muted)">No comparison data available for this item.</p>';
      overlay.classList.add('open');
      return;
    }

    const rows = item.records;
    const comparisons = analysis.consecutive;

    function fmtRow(r, label) {
      return `
        <div class="why-purchase-card">
          <div class="why-purchase-label">${escapeHtml(label)}</div>
          <table class="why-table">
            <tr><td>Vendor</td><td>${escapeHtml(r.vendorName || '—')}</td></tr>
            <tr><td>PO Number</td><td>${escapeHtml(r.poNumber || '—')}</td></tr>
            <tr><td>Date</td><td>${escapeHtml(r.poDate || '—')}</td></tr>
            <tr><td>Quantity</td><td>${(r.quantity || 0).toLocaleString('en-IN')}</td></tr>
            <tr><td>Unit Rate</td><td>${formatMoney(r.unitRate)}</td></tr>
            <tr><td>Discount</td><td>${formatMoney(r.discount)}</td></tr>
            <tr><td>Delivery</td><td>${formatMoney(r.deliveryCharge)}</td></tr>
            <tr><td>Tax Rate</td><td>${r.taxRate ? r.taxRate + '%' : '—'}</td></tr>
            <tr><td>Tax Amount</td><td>${formatMoney(r.taxAmount)}</td></tr>
            ${r.dimension ? `<tr><td>Dimension</td><td>${escapeHtml(r.dimension)}</td></tr>` : ''}
          </table>
        </div>
      `;
    }

    let html = `<div class="why-header-note">Showing ${rows.length} purchase${rows.length > 1 ? 's' : ''} of this item across ${comparisons.length} comparison${comparisons.length > 1 ? 's' : ''}.</div>`;

    comparisons.forEach((cmp, idx) => {
      const rA = cmp.recordA, rB = cmp.recordB;
      const priceDiff = rB.unitRate - rA.unitRate;
      const diffLabel = priceDiff > 0 ? `+${formatMoney(Math.abs(priceDiff))}` : priceDiff < 0 ? `−${formatMoney(Math.abs(priceDiff))}` : 'No change';
      const diffColor = priceDiff > 0 ? 'var(--rose)' : priceDiff < 0 ? 'var(--teal)' : 'var(--text-faint)';

      html += `
        <div class="why-comparison-block">
          ${comparisons.length > 1 ? `<div class="why-comparison-heading">Comparison ${idx + 1}</div>` : ''}
          <div class="why-purchases-row">
            ${fmtRow(rA, 'Purchase ' + (cmp.indexA + 1))}
            <div class="why-arrow">
              <div class="why-rate-change" style="color:${diffColor}">${diffLabel}</div>
              →
            </div>
            ${fmtRow(rB, 'Purchase ' + (cmp.indexB + 1))}
          </div>
          <div class="why-conclusion-block">
            <div class="why-conclusion-header">
              <span class="why-ai-label">AI Conclusion</span>
              <span class="why-confidence" style="background:${cmp.confidence >= 80 ? 'var(--teal)' : cmp.confidence >= 60 ? 'var(--amber)' : 'var(--rose)'}">
                ${cmp.confidence}% confidence
              </span>
            </div>
            <div class="why-conclusion-text">${escapeHtml(cmp.conclusion)}</div>
            ${cmp.factors.length > 1 ? `
              <div class="why-factors">
                ${cmp.factors.map(f => `<div class="why-factor-item">• ${escapeHtml(f.text)}</div>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    body.innerHTML = html;
    overlay.classList.add('open');
  }

  /* ----------------------------------------------------------------
     ITEM TABLE UPDATE — add Why? button to duplicate rows
     ---------------------------------------------------------------- */
  function renderItemTable() {
    const tbody = document.getElementById('itemTableBody');
    tbody.innerHTML = '';
    App.derivedState.itemAnalysis.forEach(item => {
      const trendClass = item.trend === 'increasing' ? 'trend-up' : item.trend === 'decreasing' ? 'trend-down' : 'trend-flat';
      const trendArrow = item.trend === 'increasing' ? '▲' : item.trend === 'decreasing' ? '▼' : '–';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.itemDescription)}${item.isDuplicate ? '<span class="dup-badge">DUPLICATE</span>' : ''}</td>
        <td>${escapeHtml(item.category)}</td>
        <td class="tabular">${item.purchaseFrequency}</td>
        <td class="tabular">${item.totalQuantity.toLocaleString('en-IN')}</td>
        <td class="tabular">${formatMoney(item.avgUnitRate)}</td>
        <td class="tabular">${formatMoney(item.latestUnitRate)}</td>
        <td class="tabular">${formatMoney(item.minRate)}</td>
        <td class="tabular">${formatMoney(item.maxRate)}</td>
        <td class="tabular">${formatMoney(item.totalPurchaseValue)}</td>
        <td class="tabular ${trendClass}">${trendArrow} ${item.priceChangePct.toFixed(1)}%</td>
        <td>${item.isDuplicate && item.priceAnalysis
          ? `<button class="why-btn" data-item-key="${escapeHtml(item.itemKey)}">Why?</button>`
          : '—'
        }</td>
      `;
      tbody.appendChild(tr);
    });

    // Wire Why? buttons after DOM insertion
    tbody.querySelectorAll('.why-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.itemKey;
        const item = App.derivedState.itemAnalysis.find(i => i.itemKey === key)
          || App.state.itemAnalysis.find(i => i.itemKey === key); // fall back to full-state if filtered out
        if (item) openWhyModal(item);
      });
    });
  }

  /* ---------------- Rendering: Data table ---------------- */
  function initTableControls() {
    document.getElementById('dataSearchInput').addEventListener('input', (e) => {
      App.searchTerm = e.target.value.toLowerCase();
      renderDataTable();
    });
    document.querySelectorAll('table.data-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (App.sortCol === col) App.sortDir *= -1; else { App.sortCol = col; App.sortDir = 1; }
        renderDataTable();
      });
    });
  }

  function renderDataTable() {
    if (!App.filteredRows) return;
    let rows = App.filteredRows.slice();
    if (App.searchTerm) {
      rows = rows.filter(r =>
        (r.poNumber || '').toLowerCase().includes(App.searchTerm) ||
        (r.vendorName || '').toLowerCase().includes(App.searchTerm) ||
        (r.itemDescription || '').toLowerCase().includes(App.searchTerm) ||
        (r.poRaisedBy || '').toLowerCase().includes(App.searchTerm) ||
        (r.gstn || '').toLowerCase().includes(App.searchTerm) ||
        (r.remarks || '').toLowerCase().includes(App.searchTerm)
      );
    }
    if (App.sortCol) {
      rows.sort((a, b) => {
        const av = a[App.sortCol], bv = b[App.sortCol];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * App.sortDir;
        return String(av || '').localeCompare(String(bv || '')) * App.sortDir;
      });
    }
    const tbody = document.getElementById('dataTableBody');
    tbody.innerHTML = '';
    const MAX_ROWS = 500;
    rows.slice(0, MAX_ROWS).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.poNumber)}</td>
        <td>${escapeHtml(r.poDate || '')}</td>
        <td>${escapeHtml(r.poRaisedBy || '')}</td>
        <td>${escapeHtml(r.vendorName)}</td>
        <td>${escapeHtml(r.itemDescription)}</td>
        <td>${escapeHtml(r.dimension || '')}</td>
        <td class="tabular">${r.quantity.toLocaleString('en-IN')}</td>
        <td>${escapeHtml(r.unit)}</td>
        <td class="tabular">${formatMoney(r.unitRate)}</td>
        <td class="tabular">${formatMoney(r.taxAmount)}</td>
        <td class="tabular">${formatMoney(r.netTotal || r.grossAmount || r.totalValue)}</td>
        <td>${escapeHtml(r.financialYear)}</td>
        <td title="${escapeHtml(r.remarks || '')}">${escapeHtml(truncateText(r.remarks || '', 30))}</td>
      `;
      tbody.appendChild(tr);
    });
    document.getElementById('dataTableCount').textContent = `Showing ${Math.min(rows.length, MAX_ROWS)} of ${rows.length} rows`;
  }

  /* ---------------- Export menu ---------------- */
  function initExportMenu() {
    const toggle = document.getElementById('exportMenuToggle');
    const menu = document.getElementById('exportMenu');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', () => menu.classList.remove('open'));

    document.getElementById('exportCsv').addEventListener('click', () => requireData(() => POExportCsv.exportCsvSummary(App.derivedState)));
    document.getElementById('exportExcel').addEventListener('click', () => requireData(() => POExportExcel.exportExcelSummary(App.derivedState)));
    document.getElementById('exportPdf').addEventListener('click', () => requireData(() => POExportPdf.exportPdfReport(App.derivedState)));
    document.getElementById('exportPptx').addEventListener('click', () => requireData(() => POExportPptx.exportPptxReport(App.derivedState)));
    document.getElementById('exportHtml').addEventListener('click', () => requireData(exportHtmlSnapshot));
  }
  function requireData(fn) {
    if (!App.derivedState) { showToast('Upload a file and generate the dashboard first', 'error'); return; }
    try { fn(); showToast('Export started — check your downloads', 'success'); }
    catch (err) { console.error(err); showToast('Export failed: ' + err.message, 'error'); }
  }

  function exportHtmlSnapshot() {
    const kpis = App.derivedState.kpis;
    const insightsHtml = App.derivedState.insights.map(i =>
      `<div style="border-left:3px solid #1d4ed8;background:#f8fafc;padding:14px;border-radius:8px;margin-bottom:10px;">
         <div style="font-weight:700;color:#1d4ed8;margin-bottom:4px;">${escapeHtml(i.title)}</div>
         <div style="color:#475569;font-size:13px;">${escapeHtml(i.text)}</div>
       </div>`).join('');
    const itemRows = App.derivedState.itemAnalysis.map(i =>
      `<tr><td>${escapeHtml(i.itemDescription)}</td><td>${i.purchaseFrequency}</td><td>${i.totalQuantity}</td>
        <td>${formatMoney(i.avgUnitRate)}</td><td>${formatMoney(i.totalPurchaseValue)}</td><td>${i.trend}</td></tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PO Dashboard Snapshot</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Inter,sans-serif;background:#f4f7fb;color:#0f172a;margin:0;padding:32px;}
      h1{font-size:22px;margin-bottom:4px;} .sub{color:#64748b;font-size:13px;margin-bottom:28px;}
      .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px;}
      .kpi{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;}
      .kpi .label{font-size:11px;color:#64748b;font-weight:600;margin-bottom:6px;}
      .kpi .value{font-size:22px;font-weight:800;color:#1d4ed8;}
      table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;}
      th,td{padding:10px 14px;text-align:left;font-size:12.5px;border-bottom:1px solid #e2e8f0;}
      th{background:#f8fafc;color:#475569;}
      h2{font-size:16px;margin-top:32px;}
    </style></head><body>
      <h1>Purchase Order Analytics — Dashboard Snapshot</h1>
      <div class="sub">Generated ${new Date().toLocaleString()}</div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Total Purchase Value</div><div class="value">${formatMoney(kpis.totalPurchaseValue)}</div></div>
        <div class="kpi"><div class="label">Total Purchase Orders</div><div class="value">${kpis.totalPOs}</div></div>
        <div class="kpi"><div class="label">Total Vendors</div><div class="value">${kpis.totalVendors}</div></div>
        <div class="kpi"><div class="label">Total Items</div><div class="value">${kpis.totalItems}</div></div>
        <div class="kpi"><div class="label">Average Unit Rate</div><div class="value">${formatMoney(kpis.avgUnitRate)}</div></div>
        <div class="kpi"><div class="label">Highest Value Item</div><div class="value" style="font-size:14px;">${kpis.highestItem ? escapeHtml(kpis.highestItem.itemDescription) : 'N/A'}</div></div>
      </div>
      <h2>AI Insights</h2>${insightsHtml}
      <h2>Item Analysis</h2>
      <table><thead><tr><th>Item</th><th>Frequency</th><th>Total Qty</th><th>Avg Rate</th><th>Total Value</th><th>Trend</th></tr></thead>
      <tbody>${itemRows}</tbody></table>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'PO_Dashboard_Snapshot.html';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- Utilities ---------------- */
  function formatMoney(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function truncateText(str, max) { return str && str.length > max ? str.slice(0, max - 1) + '…' : (str || ''); }
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function showToast(msg, type) {
    const toast = document.getElementById('toast');
    const iconMap = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span>${iconMap[type] || ''}</span><span>${escapeHtml(msg)}</span>`;
    toast.classList.add('show');
    clearTimeout(App._toastTimer);
    App._toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }
})();
