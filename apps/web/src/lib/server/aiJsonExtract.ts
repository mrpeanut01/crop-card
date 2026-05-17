/**
 * Tolerant JSON extraction from a Claude response.
 *
 * Claude sometimes wraps its JSON output in prose ("Here are my
 * suggestions:") or code fences despite "JSON ONLY" instructions —
 * especially Haiku. This helper handles, in order of attempts:
 *
 *   1. The whole text parses as JSON (the ideal case).
 *   2. The text is wrapped in a ```json ... ``` (or unlabelled ```) fence.
 *   3. The JSON object is preceded or followed by prose — extract from
 *      the first `{` to the matching last `}` via a string-aware
 *      bracket-balance walk and try to parse that substring.
 *
 * Returns `null` when no JSON object can be recovered.
 *
 * Shared between `aiInputsPlan.ts` (B-27 substitution layer) and
 * `aiSchedule.ts` (Phase 20 schedule planner / refiner). The schedule
 * side hit the same "AI's reply text claims success but the JSON
 * couldn't be parsed and the schedule fell back unchanged" failure
 * mode that motivated this extractor.
 */

export function extractJsonObject(text: string): unknown {
  if (!text) return null;

  const trimmed = text.trim();

  // 1. Direct parse.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }

  // 2. Strip a wrapping code-fence (```json ... ``` or ``` ... ```).
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      /* fallthrough */
    }
  }

  // 3. First-`{` to balanced last-`}` extraction. Walks the string
  //    tracking bracket depth + string state so rationale fields
  //    containing `{` / `}` don't confuse the balance counter.
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
