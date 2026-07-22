/* ============================================================
   PO Dashboard — Smart Purchase Recommendations
   Uses scorecards, savings analysis, and purchase history to
   generate actionable vendor/item recommendations. Every
   recommendation is derived entirely from available data.
   ============================================================ */
(function (global) {
  function fmtMoney(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * Generates smart recommendations from the full analysis state.
   * @param {Object} params
   * @param {Array}  params.itemAnalysis
   * @param {Array}  params.scorecards     — output of buildVendorScorecards
   * @param {Object} params.savingsResult  — output of analyzeSavings
   * @param {Object} params.vendorTotals
   * @returns {Array<Object>} recommendations, each with type, icon, title, body, metric
   */
  function generateRecommendations({ itemAnalysis, scorecards, savingsResult, vendorTotals }) {
    const recs = [];

    // ---- 1. Recommended Vendor (highest overall score) ----
    if (scorecards.length) {
      const best = scorecards[0];
      recs.push({
        type: 'recommended-vendor',
        icon: 'award',
        title: 'Recommended Vendor',
        body: `${best.vendorName} scores ${best.overallScore}/100 — the highest overall rating based on price stability, purchase frequency, and spend scale.`,
        metric: `${best.overallScore}/100`,
        metricLabel: 'Overall Score',
        vendor: best.vendorName
      });
    }

    // ---- 2. Lowest Average Unit Rate Vendor ----
    const withRates = scorecards.filter(c => c.avgUnitRate > 0).sort((a, b) => a.avgUnitRate - b.avgUnitRate);
    if (withRates.length) {
      const cheapest = withRates[0];
      recs.push({
        type: 'lowest-avg-rate',
        icon: 'trending-down',
        title: 'Lowest Average Unit Rate',
        body: `${cheapest.vendorName} has the lowest average unit rate of ${fmtMoney(cheapest.avgUnitRate)} across all their supplied items.`,
        metric: fmtMoney(cheapest.avgUnitRate),
        metricLabel: 'Avg Unit Rate',
        vendor: cheapest.vendorName
      });
    }

    // ---- 3. Most Consistent Vendor (highest price stability) ----
    const byStability = scorecards.slice().sort((a, b) => b.priceStability - a.priceStability);
    if (byStability.length) {
      const mostConsistent = byStability[0];
      recs.push({
        type: 'most-consistent',
        icon: 'shield',
        title: 'Most Consistent Pricing',
        body: `${mostConsistent.vendorName} shows the most stable pricing (stability score ${mostConsistent.priceStability}/100), making budget forecasting most reliable when ordering from them.`,
        metric: `${mostConsistent.priceStability}/100`,
        metricLabel: 'Price Stability',
        vendor: mostConsistent.vendorName
      });
    }

    // ---- 4. Most Frequently Used Vendor ----
    const byFreq = scorecards.slice().sort((a, b) => b.purchaseCount - a.purchaseCount);
    if (byFreq.length) {
      const mostUsed = byFreq[0];
      recs.push({
        type: 'most-frequent',
        icon: 'repeat',
        title: 'Most Frequently Used Vendor',
        body: `${mostUsed.vendorName} has the most purchase orders (${mostUsed.purchaseCount}), representing an established relationship worth exploring for consolidated deals.`,
        metric: `${mostUsed.purchaseCount} POs`,
        metricLabel: 'Purchase Orders',
        vendor: mostUsed.vendorName
      });
    }

    // ---- 5. Highest Saving Vendor (cheapest alternative for highest-savings item) ----
    if (savingsResult && savingsResult.items.length) {
      const topSavingsItem = savingsResult.items[0];
      recs.push({
        type: 'highest-saving',
        icon: 'piggy-bank',
        title: 'Highest Saving Opportunity',
        body: topSavingsItem.text,
        metric: fmtMoney(topSavingsItem.potentialSavings),
        metricLabel: 'Potential Saving',
        vendor: topSavingsItem.cheaperVendor,
        item: topSavingsItem.itemDescription
      });
    }

    // ---- 6. Consolidation opportunity: items bought from multiple vendors ----
    const multiVendorItems = itemAnalysis.filter(i => i.isDuplicate && i.vendorCount > 1);
    if (multiVendorItems.length) {
      const top = multiVendorItems.sort((a, b) => b.totalPurchaseValue - a.totalPurchaseValue)[0];
      recs.push({
        type: 'consolidate',
        icon: 'git-merge',
        title: 'Consolidate Multi-Vendor Purchases',
        body: `"${top.itemDescription}" was sourced from ${top.vendorCount} vendors. Consolidating to the lowest-rate supplier (${fmtMoney(top.minRate)}/unit) could reduce coordination overhead and negotiate better volume pricing.`,
        metric: `${multiVendorItems.length} item${multiVendorItems.length > 1 ? 's' : ''}`,
        metricLabel: 'Items to Consolidate'
      });
    }

    // ---- 7. Rising price watch: items with increasing trend ----
    const risingItems = itemAnalysis.filter(i => i.trend === 'increasing' && i.purchaseFrequency > 1)
      .sort((a, b) => b.priceChangePct - a.priceChangePct);
    if (risingItems.length) {
      const top = risingItems[0];
      recs.push({
        type: 'price-watch',
        icon: 'alert-triangle',
        title: 'Price Increase Alert — Renegotiate',
        body: `"${top.itemDescription}" has risen ${top.priceChangePct.toFixed(1)}% from ${fmtMoney(top.earliestUnitRate)} to ${fmtMoney(top.latestUnitRate)} per unit. Consider renegotiating with ${top.vendors[0]} or sourcing an alternative.`,
        metric: `+${top.priceChangePct.toFixed(1)}%`,
        metricLabel: 'Price Increase',
        item: top.itemDescription
      });
    }

    return recs;
  }

  global.PORecommendations = { generateRecommendations };
  if (typeof module !== 'undefined') module.exports = global.PORecommendations;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
