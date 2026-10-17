/** Shared shapes for the e2e fixture Claude (TEST ONLY). Each cluster's
 *  canned answers live in their own module and plug into the dispatch table
 *  in `claude.ts` (R-24). */

export class FixtureNoAnswerError extends Error {
  constructor(what = 'request') {
    super(`The e2e fixture Claude has no canned answer for this ${what}.`);
    this.name = 'FixtureNoAnswerError';
  }
}

export type TextBlock = { type: 'text'; text: string };
export type Msg = {
  role: 'user' | 'assistant';
  content: string | ReadonlyArray<{ type: string; text?: string }>;
};

export interface CreateParams {
  model: string;
  system?: string | ReadonlyArray<{ type: string; text?: string }>;
  messages: ReadonlyArray<Msg>;
}

export interface FixtureMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<TextBlock & { citations: null }>;
  stop_reason: 'end_turn';
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export function textOf(content: Msg['content'] | CreateParams['system']): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('\n');
}

/** The whole prompt a request carries: system text and every turn. */
export function promptText(params: CreateParams): string {
  return [textOf(params.system), ...params.messages.map((m) => textOf(m.content))].join('\n');
}

/** One row of the fixture dispatch table. `answer` may throw
 *  `FixtureNoAnswerError` for a request it matched but cannot answer. */
export interface FixtureEntry {
  name: string;
  matches(params: CreateParams): boolean;
  answer(params: CreateParams): string | FixtureMessage;
}

/** True when the prompt names `marker` anywhere (system or turns). */
export function promptHasMarker(params: CreateParams, marker: string): boolean {
  return promptText(params).includes(marker);
}
