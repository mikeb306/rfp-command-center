import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let vendors = null;

function loadVendors() {
  if (vendors) return vendors;
  const jsonPath = join(
    process.env.CROWN_PAYEE_PATH ||
    join(dirname(fileURLToPath(import.meta.url)), '../../../../clawd/LightRAG/data/crown-payee-it-vendors.json')
  );
  try {
    vendors = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch {
    vendors = [];
  }
  return vendors;
}

/**
 * Find incumbent vendors for a given buyer (crown corporation).
 * Matches against the "crown" field in the dataset.
 * Returns top vendors sorted by spend descending.
 */
export function getIncumbentsForBuyer(buyerName, limit = 10) {
  const data = loadVendors();
  if (!buyerName || !data.length) return [];

  const needle = buyerName.toLowerCase();

  const matches = data
    .filter(v => v.crown && v.crown.toLowerCase().includes(needle))
    .sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))
    .slice(0, limit);

  return matches;
}

/**
 * Find all crown contracts for a specific vendor.
 * Useful for competitive analysis: "What does WBM hold across all Crowns?"
 */
export function getVendorContracts(vendorName, limit = 20) {
  const data = loadVendors();
  if (!vendorName || !data.length) return [];

  const needle = vendorName.toLowerCase();

  return data
    .filter(v => v.vendor && v.vendor.toLowerCase().includes(needle))
    .sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))
    .slice(0, limit);
}

/**
 * Build a competitive intelligence summary for the adversarial analysis pass.
 * Given a buyer name, returns a formatted string of incumbent vendors and spend.
 */
export function buildIncumbentIntelBlock(buyerName) {
  const incumbents = getIncumbentsForBuyer(buyerName, 10);
  if (!incumbents.length) return '';

  const lines = incumbents.map(v =>
    `  - ${v.vendor}: $${v.amount} (${v.crown})`
  );

  return `\n\nCROWN PAYEE INTELLIGENCE (real SK government spend data):
Known IT vendors for "${buyerName}":
${lines.join('\n')}

Use this data to assess incumbent advantage. If a competitor has significant existing spend with this buyer, they likely have deep relationships, existing infrastructure, and switching-cost advantages that Xerox IT Solutions must overcome.`;
}
