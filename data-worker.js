/* ============================================================
   PO Dashboard — Background Processing Worker
   Runs all heavy analysis off the main thread so the UI stays
   responsive even on 100,000+ row files.
   ============================================================ */
importScripts('data-core.js', 'price-analysis.js', 'savings-analysis.js', 'vendor-scorecard.js', 'recommendations.js', 'smart-alerts.js');

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || msg.type !== 'process') return;

  try {
    self.postMessage({ type: 'progress', stage: 'Mapping columns and cleaning data…' });
    const state = self.PODataCore.processDataset(msg.headers, msg.rows);

    self.postMessage({ type: 'progress', stage: 'Analysing prices and savings…' });
    state.savingsResult = self.POSavingsAnalysis.analyzeSavings(state.itemAnalysis);

    self.postMessage({ type: 'progress', stage: 'Building vendor scorecards…' });
    state.scorecards = self.POVendorScorecard.buildVendorScorecards(state.rows, state.itemAnalysis, state.vendorTotals);

    self.postMessage({ type: 'progress', stage: 'Generating recommendations and alerts…' });
    state.recommendations = self.PORecommendations.generateRecommendations({
      itemAnalysis: state.itemAnalysis, scorecards: state.scorecards,
      savingsResult: state.savingsResult, vendorTotals: state.vendorTotals
    });
    state.alerts = self.POSmartAlerts.generateAlerts({
      rows: state.rows, itemAnalysis: state.itemAnalysis,
      vendorTotals: state.vendorTotals, taxByRate: state.taxByRate,
      discountAnalysis: state.discountAnalysis, totalPurchaseValue: state.kpis.totalPurchaseValue
    });

    self.postMessage({ type: 'progress', stage: 'Finalizing…' });
    self.postMessage({ type: 'done', state });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
