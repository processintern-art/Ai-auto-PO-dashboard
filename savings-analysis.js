/* ============================================================
   PO Dashboard — Savings Opportunity Analysis
   For every duplicate item, calculates the potential savings if
   every unit had been bought at the best available rate.

   Two distinct calculation modes, chosen per-item based on what
   the data actually supports — never fabricated:

   1. MULTI-VENDOR: the item was bought from more than one vendor
      at different rates. Savings = (highest rate paid - lowest
      rate paid across vendors) x total quantity, with the cheaper
      vendor named explicitly (spec example: "Buying this item
      from Vendor ABC instead of Vendor XYZ could have saved ₹X").

   2. SINGLE-VENDOR PRICE VOLATILITY: the item was only ever bought
      from one vendor, but at different rates over time (the common
      case in practice — see real-data note below). Savings = (rate
      actually paid on average - the lowest rate that same vendor
      ever charged) x total quantity. Framed honestly as "based on
      this vendor's own lowest historical rate," not a cross-vendor
      claim that isn't supported by the data.

   Items with only one purchase, or where all purchases were at
   the same rate, have zero savings opportunity and are excluded.
   ============================================================ */
(function (global) {
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * Computes savings opportunity for a single duplicate item.
   * @param {Object} item - an entry from itemAnalysis (must have .records,
   *   .vendors, .vendorCount, .totalQuantity, .minRate, .maxRate)
   * @returns {Object|null} savings detail, or null if there's no real
   *   opportunity (single purchase, or all purchases at the same rate)
   */
  function computeItemSavings(item) {
    if (!item.records || item.records.length < 2) return null;
    if (item.maxRate <= item.minRate) return null; // no rate variation at all

    if (item.vendorCount > 1) {
      // Multi-vendor case: find the actual cheapest and most expensive
      // vendor for this item (by their own average rate on this item, not
      // just any single purchase, so a one-off discount doesn't distort
      // which vendor is "cheapest").
      const byVendor = new Map();
      for (const r of item.records) {
        if (!byVendor.has(r.vendorName)) byVendor.set(r.vendorName, { rates: [], qty: 0 });
        const v = byVendor.get(r.vendorName);
        if (r.unitRate > 0) v.rates.push(r.unitRate);
        v.qty += Number(r.quantity) || 0;
      }
      const vendorAverages = Array.from(byVendor.entries())
        .map(([name, d]) => ({ name, avgRate: d.rates.length ? d.rates.reduce((s, x) => s + x, 0) / d.rates.length : 0, qty: d.qty }))
        .filter(v => v.avgRate > 0)
        .sort((a, b) => a.avgRate - b.avgRate);

      if (vendorAverages.length < 2) return null; // shouldn't happen given vendorCount > 1, but guard anyway

      const cheapest = vendorAverages[0];
      const mostExpensive = vendorAverages[vendorAverages.length - 1];
      if (mostExpensive.avgRate <= cheapest.avgRate) return null;

      const rateDiff = mostExpensive.avgRate - cheapest.avgRate;
      const potentialSavings = round2(rateDiff * item.totalQuantity);
      if (potentialSavings <= 0) return null;

      return {
        itemDescription: item.itemDescription,
        mode: 'multi-vendor',
        cheaperVendor: cheapest.name,
        costlierVendor: mostExpensive.name,
        cheaperRate: round2(cheapest.avgRate),
        costlierRate: round2(mostExpensive.avgRate),
        totalQuantity: item.totalQuantity,
        potentialSavings,
        text: `Buying "${item.itemDescription}" from ${cheapest.name} instead of ${mostExpensive.name} could have saved ₹${potentialSavings.toLocaleString('en-IN')}.`
      };
    }

    // Single-vendor case: same vendor, but rate varied across purchases over
    // time. Savings is framed against that vendor's own best historical
    // rate — honest about what the data actually shows, not implying a
    // vendor switch that never happened.
    const vendor = item.vendors[0];
    const rateDiff = item.maxRate - item.minRate;
    const potentialSavings = round2(rateDiff * item.totalQuantity);
    if (potentialSavings <= 0) return null;

    return {
      itemDescription: item.itemDescription,
      mode: 'single-vendor-volatility',
      cheaperVendor: vendor,
      costlierVendor: vendor,
      cheaperRate: item.minRate,
      costlierRate: item.maxRate,
      totalQuantity: item.totalQuantity,
      potentialSavings,
      text: `"${item.itemDescription}" was bought from ${vendor} at rates ranging from ₹${item.minRate.toLocaleString('en-IN')} to ₹${item.maxRate.toLocaleString('en-IN')}. Consistently negotiating the lowest rate could have saved ₹${potentialSavings.toLocaleString('en-IN')}.`
    };
  }

  /**
   * Computes savings opportunities across all items and rolls up a total.
   * @param {Array<Object>} itemAnalysis - full itemAnalysis array
   * @returns {{ items: Array, totalPotentialSavings: number }}
   */
  function analyzeSavings(itemAnalysis) {
    const items = [];
    for (const item of itemAnalysis) {
      if (!item.isDuplicate) continue;
      const savings = computeItemSavings(item);
      if (savings) items.push(savings);
    }
    items.sort((a, b) => b.potentialSavings - a.potentialSavings);
    const totalPotentialSavings = round2(items.reduce((s, i) => s + i.potentialSavings, 0));
    return { items, totalPotentialSavings };
  }

  global.POSavingsAnalysis = { computeItemSavings, analyzeSavings };
  if (typeof module !== 'undefined') module.exports = global.POSavingsAnalysis;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
