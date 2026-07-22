/* ============================================================
   PO Dashboard — Smart Alerts
   Scans the processed dataset and generates alert cards for
   notable procurement patterns. Only flags alerts that are
   directly supported by the data — no invented warnings.
   ============================================================ */
(function (global) {
  function fmtMoney(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /**
   * @param {Object} params
   * @param {Array}  params.rows           — normalized PO rows
   * @param {Array}  params.itemAnalysis
   * @param {Object} params.vendorTotals
   * @param {Object} params.taxByRate
   * @param {Object} params.discountAnalysis
   * @param {Number} params.totalPurchaseValue
   * @returns {Array<Object>} alert cards, each with type, severity, icon, title, body, count, value
   */
  function generateAlerts({ rows, itemAnalysis, vendorTotals, taxByRate, discountAnalysis, totalPurchaseValue }) {
    const alerts = [];

    // ---- 1. Price Increased items ----
    const risingItems = itemAnalysis.filter(i => i.trend === 'increasing' && i.purchaseFrequency > 1);
    if (risingItems.length) {
      const worst = risingItems.sort((a, b) => b.priceChangePct - a.priceChangePct)[0];
      alerts.push({
        type: 'price-increase',
        severity: 'warning',
        icon: 'trending-up',
        title: 'Price Increase Detected',
        body: `${risingItems.length} item${risingItems.length > 1 ? 's' : ''} show rising unit rates. Worst: "${worst.itemDescription}" up ${worst.priceChangePct.toFixed(1)}%.`,
        count: risingItems.length,
        value: `+${worst.priceChangePct.toFixed(1)}%`
      });
    }

    // ---- 2. Bulk Discount opportunities found ----
    const bulkDiscountItems = itemAnalysis.filter(i => {
      if (!i.isDuplicate || i.purchaseFrequency < 2) return false;
      // Check if there are two consecutive records where qty doubled and rate fell
      for (let j = 1; j < i.records.length; j++) {
        const prev = i.records[j - 1], curr = i.records[j];
        if (curr.quantity >= prev.quantity * 2 && curr.unitRate < prev.unitRate) return true;
      }
      return false;
    });
    if (bulkDiscountItems.length) {
      alerts.push({
        type: 'bulk-discount',
        severity: 'success',
        icon: 'package',
        title: 'Bulk Discount Opportunity Found',
        body: `${bulkDiscountItems.length} item${bulkDiscountItems.length > 1 ? 's' : ''} show lower unit rates when ordered in larger quantities — consider consolidating orders.`,
        count: bulkDiscountItems.length,
        value: `${bulkDiscountItems.length} item${bulkDiscountItems.length > 1 ? 's' : ''}`
      });
    }

    // ---- 3. Duplicate purchases ----
    const duplicates = itemAnalysis.filter(i => i.isDuplicate);
    if (duplicates.length) {
      const totalDupSpend = round2(duplicates.reduce((s, i) => s + i.totalPurchaseValue, 0));
      alerts.push({
        type: 'duplicate-purchase',
        severity: 'info',
        icon: 'copy',
        title: 'Duplicate Purchases Detected',
        body: `${duplicates.length} item${duplicates.length > 1 ? 's' : ''} purchased more than once, totalling ${fmtMoney(totalDupSpend)} combined. Review for potential consolidation.`,
        count: duplicates.length,
        value: fmtMoney(totalDupSpend)
      });
    }

    // ---- 4. High Tax items ----
    // Flag if any tax rate bracket carries an unusually high total tax amount
    // (top 1 bracket by tax amount, only if it represents > 20% of total spend)
    const taxEntries = Object.entries(taxByRate).filter(([k]) => k !== 'No Tax').sort((a, b) => b[1].amount - a[1].amount);
    if (taxEntries.length && totalPurchaseValue > 0) {
      const [topTaxRate, topTaxData] = taxEntries[0];
      const taxShare = (topTaxData.amount / totalPurchaseValue) * 100;
      if (taxShare > 10) {
        alerts.push({
          type: 'high-tax',
          severity: 'info',
          icon: 'receipt',
          title: 'Significant Tax Outflow',
          body: `${topTaxRate} GST accounts for ${fmtMoney(topTaxData.amount)} in tax across ${topTaxData.count} purchase${topTaxData.count > 1 ? 's' : ''} — ${taxShare.toFixed(1)}% of total spend.`,
          count: topTaxData.count,
          value: fmtMoney(topTaxData.amount)
        });
      }
    }

    // ---- 5. High Delivery Charge alert ----
    const totalDelivery = round2(rows.reduce((s, r) => s + (r.deliveryCharge || 0), 0));
    if (totalDelivery > 0 && totalPurchaseValue > 0) {
      const deliveryShare = (totalDelivery / totalPurchaseValue) * 100;
      if (deliveryShare >= 1) {
        const highDeliveryRows = rows.filter(r => (r.deliveryCharge || 0) > 0);
        alerts.push({
          type: 'high-delivery',
          severity: 'warning',
          icon: 'truck',
          title: 'Delivery Charges Detected',
          body: `${fmtMoney(totalDelivery)} in delivery charges across ${highDeliveryRows.length} purchase line${highDeliveryRows.length > 1 ? 's' : ''} — consider negotiating free delivery thresholds with frequent vendors.`,
          count: highDeliveryRows.length,
          value: fmtMoney(totalDelivery)
        });
      }
    }

    // ---- 6. Vendor Changed on duplicate items ----
    const vendorChangedItems = itemAnalysis.filter(i => i.isDuplicate && i.vendorCount > 1);
    if (vendorChangedItems.length) {
      alerts.push({
        type: 'vendor-changed',
        severity: 'info',
        icon: 'shuffle',
        title: 'Vendor Switch Detected',
        body: `${vendorChangedItems.length} item${vendorChangedItems.length > 1 ? 's' : ''} sourced from multiple vendors — inconsistent vendor use may affect pricing and quality.`,
        count: vendorChangedItems.length,
        value: `${vendorChangedItems.length} item${vendorChangedItems.length > 1 ? 's' : ''}`
      });
    }

    // ---- 7. Low-activity vendors (only 1 PO each) ----
    const lowActivityVendors = Object.entries(vendorTotals).filter(([, d]) => d.poCount === 1);
    const totalVendors = Object.keys(vendorTotals).length;
    if (lowActivityVendors.length > 0 && totalVendors > 3) {
      alerts.push({
        type: 'low-activity-vendor',
        severity: 'info',
        icon: 'user-minus',
        title: 'Single-Order Vendors',
        body: `${lowActivityVendors.length} of ${totalVendors} vendors have only one purchase order. Consider evaluating whether these one-time vendors meet quality and pricing standards.`,
        count: lowActivityVendors.length,
        value: `${lowActivityVendors.length} vendor${lowActivityVendors.length > 1 ? 's' : ''}`
      });
    }

    // Sort: warning first, then success, then info
    const order = { warning: 0, success: 1, info: 2 };
    return alerts.sort((a, b) => (order[a.severity] || 2) - (order[b.severity] || 2));
  }

  global.POSmartAlerts = { generateAlerts };
  if (typeof module !== 'undefined') module.exports = global.POSmartAlerts;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
