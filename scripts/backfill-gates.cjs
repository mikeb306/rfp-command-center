const fs = require('fs');
const dbPath = require('path').join(__dirname, '..', 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let updated = 0;
for (const t of db.tenders) {
  if (!t.analysis) continue;
  if (!t.gates) t.gates = {};

  // Auto-approve all 3 gates for any analyzed tender
  const now = new Date().toISOString();
  const gateKeys = ['bidNoBid', 'requirementMap', 'pricingLegal'];
  for (const key of gateKeys) {
    if (!t.gates[key] || t.gates[key].status === 'pending') {
      t.gates[key] = {
        status: 'approved',
        reviewer: 'system',
        note: 'Auto-approved: analysis complete',
        decidedAt: now
      };
      updated++;
    }
  }
}
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log('Updated ' + updated + ' tenders');
