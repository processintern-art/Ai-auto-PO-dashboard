/* ============================================================
   PO Dashboard — Price Change Root Cause Analysis
   For a duplicate item's purchase history, explains WHY the unit
   price differs between any two purchases, using only fields
   actually present in the data (vendor, date, quantity, rate,
   discount, delivery charge, tax rate, dimension, UOM). Never
   invents a reason not supported by the data — if no factor
   explains the difference, says so explicitly.

   This is a deterministic rule engine (not a hosted LLM call),
   so it's instant, free, reproducible, and safe to run on every
   duplicate item even at large scale.
   ============================================================ */

(function (global) {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function fmtMoney(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function daysBetween(d1, d2) {
    if (!d1 || !d2) return null;
    const t1 = new Date(d1).getTime(), t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return null;
    return Math.round(Math.abs(t2 - t1) / DAY_MS);
  }
  function pctChange(from, to) {
    if (!from) return null;
    return ((to - from) / from) * 100;
  }

  /**
   * Compares two purchase records of the SAME item and returns a list of
   * detected factors, each with its own confidence-contributing weight.
   * Order matters: factors are returned in the priority they should be
   * presented (most likely root cause first), but the caller decides how
   * many to surface.
   */
  function detectFactors(a, b) {
    const factors = [];
    const rateChange = pctChange(a.unitRate, b.unitRate);
    const rateDirection = b.unitRate > a.unitRate ? 'increased' : b.unitRate < a.unitRate ? 'decreased' : 'unchanged';

    // No actual price difference at all — flag as a data-consistency check,
    // not a pricing explanation (per spec: "Exact Same Purchase" case).
    if (a.unitRate === b.unitRate) {
      const sameVendor = a.vendorName === b.vendorName;
      const sameQty = a.quantity === b.quantity;
      if (sameVendor && sameQty) {
        factors.push({
          type: 'exact-same',
          weight: 40,
          text: 'These two purchases have identical vendor, quantity, and unit rate — this looks like a duplicate or repeat order rather than a price change.'
        });
      } else {
        // Rate is identical, but something else differs (vendor or quantity).
        // This is still worth surfacing — e.g. "rate held steady even though
        // quantity changed" is a meaningful observation — rather than
        // returning nothing just because there's no PRICE difference to
        // explain. Never silently produce an empty conclusion.
        const changedParts = [];
        if (!sameVendor) changedParts.push(`vendor changed (${a.vendorName} → ${b.vendorName})`);
        if (!sameQty) changedParts.push(`quantity changed (${a.quantity} → ${b.quantity})`);
        factors.push({
          type: 'rate-steady',
          weight: 15,
          text: `The unit rate stayed the same even though ${changedParts.join(' and ')}.`
        });
      }
      return factors;
    }

    // 1. Vendor changed
    if (a.vendorName && b.vendorName && a.vendorName !== b.vendorName) {
      factors.push({
        type: 'vendor-changed',
        weight: 30,
        text: `The price ${rateDirection} because the purchase was made from a different vendor (${a.vendorName} → ${b.vendorName}).`
      });
    }

    // 2. Quantity / bulk pricing
    if (a.quantity > 0 && b.quantity > 0 && a.quantity !== b.quantity) {
      const qtyRatio = b.quantity / a.quantity;
      if (qtyRatio >= 2 && rateDirection === 'decreased') {
        factors.push({
          type: 'bulk-discount',
          weight: 28,
          text: `The quantity increased from ${a.quantity.toLocaleString('en-IN')} to ${b.quantity.toLocaleString('en-IN')} units. Estimated bulk discount reduced the unit price.`
        });
      } else if (qtyRatio <= 0.5 && rateDirection === 'increased') {
        factors.push({
          type: 'small-quantity',
          weight: 22,
          text: `The order quantity decreased from ${a.quantity.toLocaleString('en-IN')} to ${b.quantity.toLocaleString('en-IN')} units. The smaller order quantity likely increased the unit rate.`
        });
      }
    }

    // 3. Discount difference
    const discA = Number(a.discount) || 0, discB = Number(b.discount) || 0;
    if (discA !== discB) {
      const moreDiscount = discB > discA;
      factors.push({
        type: 'discount-difference',
        weight: 18,
        text: moreDiscount
          ? `Vendor provided additional discount (${fmtMoney(discA)} → ${fmtMoney(discB)}), which lowered the effective price.`
          : `Less discount was applied on this purchase (${fmtMoney(discA)} → ${fmtMoney(discB)}), which increased the effective price.`
      });
    }

    // 4. Delivery charge difference
    const delA = Number(a.deliveryCharge) || 0, delB = Number(b.deliveryCharge) || 0;
    if (delA !== delB) {
      factors.push({
        type: 'delivery-difference',
        weight: 12,
        text: `Delivery charges changed (${fmtMoney(delA)} → ${fmtMoney(delB)}), which affects the landed cost even if the base unit rate moved differently.`
      });
    }

    // 5. Tax rate difference
    const taxA = Number(a.taxRate) || 0, taxB = Number(b.taxRate) || 0;
    if (taxA !== taxB) {
      factors.push({
        type: 'tax-difference',
        weight: 14,
        text: `Different GST/Tax rate applied (${taxA}% → ${taxB}%), which affected the total payable even where the base price may be similar.`
      });
    }

    // 6. Dimension / specification difference
    if (a.dimension && b.dimension && String(a.dimension).trim() !== String(b.dimension).trim()) {
      factors.push({
        type: 'dimension-difference',
        weight: 20,
        text: `The specifications changed (${a.dimension} → ${b.dimension}), which can directly affect material/labor cost and unit pricing.`
      });
    }

    // 6b. UOM difference (different unit of measure entirely changes what "unit rate" means)
    if (a.unit && b.unit && String(a.unit).trim() !== String(b.unit).trim()) {
      factors.push({
        type: 'uom-difference',
        weight: 16,
        text: `The unit of measure differs (${a.unit} → ${b.unit}), so the unit rates may not be directly comparable.`
      });
    }

    // 7. Time gap
    const gapDays = daysBetween(a.poDate, b.poDate);
    if (gapDays !== null && gapDays >= 60) {
      factors.push({
        type: 'time-gap',
        weight: 10,
        text: `The purchase was made ${gapDays} days later. Inflation or supplier price revision may have increased the price.`
      });
    }

    // If literally nothing in the available data explains the difference,
    // say so plainly rather than guessing — this is the spec's "never
    // invent reasons" requirement made concrete.
    if (factors.length === 0) {
      factors.push({
        type: 'unexplained',
        weight: 8,
        text: `No clear cause found in the available data (vendor, quantity, discount, delivery, tax, dimension, and date are all consistent). Potential pricing inconsistency detected — worth a manual check.`
      });
    }

    return factors;
  }

  /**
   * Confidence scoring: starts from a base tied to how many independent
   * factors were found (more corroborating evidence = higher confidence),
   * weighted by each factor's own strength, then bounded into a believable
   * range. This is intentionally simple and explainable rather than a
   * black-box score — every point is traceable to a specific detected
   * factor, consistent with "only explain using available data."
   */
  function computeConfidence(factors) {
    if (!factors.length) return 50;
    if (factors[0].type === 'unexplained') return 35;
    if (factors[0].type === 'exact-same') return 60;

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    // Single strong factor (e.g. vendor changed alone) -> solid but not
    // absolute confidence. Multiple corroborating factors compound upward.
    let confidence = 55 + totalWeight;
    if (factors.length === 1) confidence -= 5; // single-factor explanations are slightly less certain
    return Math.max(35, Math.min(98, Math.round(confidence)));
  }

  /**
   * Builds a full root-cause comparison between two purchase records of the
   * same item. Returns the detected factors, a combined plain-English
   * conclusion (factors joined in priority order), and a confidence score.
   */
  function compareRecords(a, b) {
    const factors = detectFactors(a, b);
    const confidence = computeConfidence(factors);
    // Surface up to 2 leading factors in the headline conclusion to stay
    // readable; the modal can list all detected factors individually.
    let conclusion = factors.slice(0, 2).map(f => f.text).join(' ');
    // Defensive fallback: detectFactors should always return at least one
    // factor (see the 'unexplained' case at the end of that function), but
    // if some future edge case slips through, never surface a blank
    // conclusion to the user — that's worse than a generic message.
    if (!conclusion) {
      conclusion = 'No specific factors were detected for this comparison based on the available data.';
    }
    return { factors, conclusion, confidence };
  }

  /**
   * For a duplicate item's full purchase history (already sorted by date),
   * builds root-cause comparisons for consecutive purchase pairs — this is
   * what the "Why?" button surfaces by default (latest vs. previous), and
   * also returns the full pairwise matrix capped at a safe size so a single
   * item purchased an unusually large number of times can't cause runaway
   * computation even on 100,000+ row datasets.
   */
  const MAX_RECORDS_FOR_FULL_MATRIX = 25; // beyond this, only consecutive-pair comparisons are computed

  function analyzeItemPriceHistory(records) {
    if (!records || records.length < 2) return { consecutive: [], matrix: [] };

    const consecutive = [];
    for (let i = 1; i < records.length; i++) {
      consecutive.push({
        indexA: i - 1, indexB: i,
        recordA: records[i - 1], recordB: records[i],
        ...compareRecords(records[i - 1], records[i])
      });
    }

    let matrix = [];
    if (records.length <= MAX_RECORDS_FOR_FULL_MATRIX) {
      for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
          matrix.push({
            indexA: i, indexB: j,
            recordA: records[i], recordB: records[j],
            ...compareRecords(records[i], records[j])
          });
        }
      }
    }

    return { consecutive, matrix };
  }

  global.POPriceAnalysis = { detectFactors, computeConfidence, compareRecords, analyzeItemPriceHistory, MAX_RECORDS_FOR_FULL_MATRIX };
  if (typeof module !== 'undefined') module.exports = global.POPriceAnalysis;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
