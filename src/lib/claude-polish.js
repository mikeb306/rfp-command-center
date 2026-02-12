const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function polishDrafts(drafts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !drafts || drafts.length === 0) return drafts;

  // Build the full text to polish
  const sectionTexts = drafts
    .filter((d) => d.draft && d.provider !== 'skipped')
    .map((d) => `### ${d.sectionTitle}\n${d.draft}`)
    .join('\n\n---\n\n');

  if (!sectionTexts.trim()) return drafts;

  const schema = {
    type: 'json',
    schema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sectionTitle: { type: 'string' },
              polishedDraft: { type: 'string' }
            },
            required: ['sectionTitle', 'polishedDraft']
          }
        }
      },
      required: ['sections']
    }
  };

  const body = {
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    system: `You are a senior RFP response writer. Polish this proposal for submission. Tighten language, ensure professional tone, fix awkward phrasing, strengthen value propositions. Do not remove facts, citations, or technical details. Return the polished text for each section as JSON with format: {"sections": [{"sectionTitle": "...", "polishedDraft": "..."}]}`,
    messages: [
      {
        role: 'user',
        content: `Polish these proposal sections for a government/enterprise RFP submission. Return JSON.\n\n${sectionTexts}`
      }
    ]
  };

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) return drafts;

    const payload = await response.json();
    const textBlock = payload?.content?.find((b) => b.type === 'text');
    if (!textBlock?.text) return drafts;

    // Extract JSON from response (may be wrapped in markdown code fences)
    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed?.sections)) return drafts;

    // Merge polished drafts back
    const polishedMap = new Map();
    for (const s of parsed.sections) {
      if (s.sectionTitle && s.polishedDraft) {
        polishedMap.set(s.sectionTitle.toLowerCase(), s.polishedDraft);
      }
    }

    return drafts.map((d) => {
      const polished = polishedMap.get(d.sectionTitle.toLowerCase());
      if (polished && d.provider !== 'skipped') {
        return { ...d, draft: polished, polished: true };
      }
      return d;
    });
  } catch {
    // Graceful fallback: return unpolished drafts
    return drafts;
  }
}
