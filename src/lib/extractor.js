import { extractRequirementsWithOpenAI } from './openai.js';

const REQ_PATTERNS = [
  { reqType: 'security', mustHave: true, regex: /security|privacy|PIPEDA|FOIP|encryption|MFA/i },
  { reqType: 'sla', mustHave: true, regex: /\bSLA\b|service level|uptime|response time/i },
  { reqType: 'pricing', mustHave: false, regex: /pricing|cost|fee|rate card|budget/i },
  { reqType: 'timeline', mustHave: true, regex: /timeline|schedule|closing date|submission deadline/i },
  { reqType: 'deliverable', mustHave: false, regex: /deliverable|scope of work|statement of work|SOW/i },
  { reqType: 'evaluation', mustHave: false, regex: /evaluation|rated criteria|scoring/i },
  { reqType: 'mandatory', mustHave: true, regex: /\bmust\b|\bmandatory\b|\brequired\b/i }
];

export async function extractRequirementsForTender({ tenderId, documents }) {
  const joinedText = documents.map((doc) => `# ${doc.filename}\n${doc.text}`).join('\n\n');

  if (process.env.OPENAI_API_KEY) {
    try {
      const fromLlm = await extractRequirementsWithOpenAI({
        tenderId,
        documents,
        joinedText
      });
      if (fromLlm.length > 0) {
        return {
          provider: 'openai',
          requirements: fromLlm
        };
      }
    } catch {
      // If model extraction fails, continue with deterministic fallback.
    }
  }

  return {
    provider: 'heuristic',
    requirements: extractRequirementsHeuristic(documents)
  };
}

export function extractRequirementsHeuristic(documents) {
  const output = [];

  for (const doc of documents) {
    const lines = doc.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length < 25) continue;

      const pattern = REQ_PATTERNS.find((item) => item.regex.test(line));
      if (!pattern) continue;

      output.push({
        reqType: pattern.reqType,
        mustHave: pattern.mustHave,
        statement: normalizeStatement(line),
        sectionRef: `line:${i + 1}`,
        confidence: inferConfidence(line, pattern.reqType),
        provenanceDocId: doc.docId,
        provenanceSpan: `line:${i + 1}`
      });
    }
  }

  return dedupeRequirements(output);
}

function inferConfidence(line, reqType) {
  let score = 0.6;
  if (/must|required|mandatory/i.test(line)) score += 0.2;
  if (/shall/i.test(line)) score += 0.1;
  if (reqType === 'evaluation') score -= 0.1;
  if (line.length > 140) score -= 0.05;
  return Math.max(0.3, Math.min(0.95, Number(score.toFixed(2))));
}

function normalizeStatement(input) {
  return input.replace(/\s+/g, ' ').trim();
}

function dedupeRequirements(requirements) {
  const seen = new Set();
  const out = [];

  for (const req of requirements) {
    const key = `${req.reqType}:${req.statement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(req);
  }

  return out;
}
