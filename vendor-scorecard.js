/* ============================================================
   PO Dashboard — Vendor Scorecard
   For every vendor, computes: average unit rate, total spend,
   purchase count, price stability, duplicate items supplied, and
   an overall 0-100 score.

   Scoring methodology (explainable, not a black box):
   - Price Stability (40 pts): based on the coefficient of variation
     (std dev / mean) of unit rates this vendor charged across all
     their line items. Lower variation = higher score. A vendor
     with only one rate ever charged scores full marks here (no
     volatility observed).
   - Purchase Frequency (25 pts): scaled relative to the busiest
     vendor in the dataset — rewards vendors with an established,
     repeatable purchasing relationship over one-off vendors.
   - Spend Scale (15 pts): scaled relative to the highest-spend
     vendor — a small signal, not a dominant one, since high spend
     isn't inherently "good," but consistent significant business
     is a meaningful positive signal worth a modest weight.
   - Duplicate-Item Penalty (up to -20 pts): vendors supplying items
     that were also bought elsewhere (or repeatedly at varying
     rates) lose points proportional to how much of their item mix
     is duplicated/volatile, since this often correlates with
     inconsistent pricing.
   All components are clamped and the total is bounded to [0, 100].
   ============================================================ */
(function (global) {
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length;
    return Math.sqrt(variance);
  }

  /**
   * Builds a scorecard for every vendor present in the row set.
   * @param {Array<Object>} rows - normalized PO rows (from processDataset)
   * @param {Array<Object>} itemAnalysis - full itemAnalysis array (for
   *   identifying which items each vendor's purchases overlap with)
   * @param {Object} vendorTotals - the vendorTotals object from
   *   computeAggregates (already has total spend / PO count per vendor)
   * @returns {Array<Object>} one scorecard entry per vendor, sorted by
   *   overall score descending
   */
  function buildVendorScorecards(rows, itemAnalysis, vendorTotals) {
    const byVendor = new Map();
    for (const r of rows) {
      if (!byVendor.has(r.vendorName)) byVendor.set(r.vendorName, { rates: [], lineCount: 0, itemKeys: new Set() });
      const v = byVendor.get(r.vendorName);
      if (r.unitRate > 0) v.rates.push(r.unitRate);
      v.lineCount++;
    }

    // Map each duplicate item to the set of vendors that supplied it, so we
    // can identify which vendors are involved in duplicate/volatile items.
    const duplicateItemVendors = new Set();
    for (const item of itemAnalysis) {
      if (item.isDuplicate) {
        for (const v of item.vendors) duplicateItemVendors.add(v);
      }
    }

    const maxSpend = Math.max(1, ...Object.values(vendorTotals).map(v => v.total));
    const maxPoCount = Math.max(1, ...Object.values(vendorTotals).map(v => v.poCount));

    const scorecards = [];
    for (const [vendorName, vTotal] of Object.entries(vendorTotals)) {
      const v = byVendor.get(vendorName) || { rates: [], lineCount: 0 };
      const avgUnitRate = round2(mean(v.rates));
      const sd = stdDev(v.rates);
      // Coefficient of variation as a 0..1+ measure of relative volatility;
      // a vendor with a single rate (or all identical rates) has sd = 0,
      // meaning zero observed volatility -> full stability score.
      const coefficientOfVariation = avgUnitRate > 0 ? sd / avgUnitRate : 0;
      const stabilityScore = Math.max(0, 40 - Math.min(40, coefficientOfVariation * 80));

      const frequencyScore = Math.min(25, (vTotal.poCount / maxPoCount) * 25);
      const spendScore = Math.min(15, (vTotal.total / maxSpend) * 15);

      const hasDuplicateItems = duplicateItemVendors.has(vendorName);
      const duplicatePenalty = hasDuplicateItems ? Math.min(20, coefficientOfVariation * 30) : 0;

      const overallScore = Math.max(0, Math.min(100, Math.round(
        stabilityScore + frequencyScore + spendScore + 20 /* base participation points */ - duplicatePenalty
      )));

      scorecards.push({
        vendorName,
        avgUnitRate,
        totalSpend: round2(vTotal.total),
        purchaseCount: vTotal.poCount,
        priceStability: Math.round(stabilityScore / 40 * 100), // expressed as a 0-100 sub-score for display
        duplicateItems: hasDuplicateItems,
        overallScore,
        _components: { stabilityScore: round2(stabilityScore), frequencyScore: round2(frequencyScore), spendScore: round2(spendScore), duplicatePenalty: round2(duplicatePenalty) }
      });
    }

    return scorecards.sort((a, b) => b.overallScore - a.overallScore);
  }

  global.POVendorScorecard = { buildVendorScorecards };
  if (typeof module !== 'undefined') module.exports = global.POVendorScorecard;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
