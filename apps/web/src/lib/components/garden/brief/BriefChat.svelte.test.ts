/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BriefChat from './BriefChat.svelte';
import { transcriptLines } from '$lib/garden/brief/schema';

// #870 (FU870-3): a returning owner's stored turns, read-only when Claude is off.

const lines = transcriptLines(
  [
    {
      question: 'I cook a lot of pasta.',
      reply: 'Basil loves a sunny step.',
      provenance: 'ai',
      at: 1
    },
    { question: 'And tea?', reply: null, provenance: 'fallback', at: 2 }
  ],
  'Answer the questions on the left.'
);

describe('BriefChat with a stored conversation', () => {
  it('turns stored turns into lines, the form reply for a null one', () => {
    expect(lines).toEqual([
      { role: 'user', text: 'I cook a lot of pasta.' },
      { role: 'assistant', text: 'Basil loves a sunny step.', provenance: 'ai' },
      { role: 'user', text: 'And tea?' },
      { role: 'assistant', text: 'Answer the questions on the left.', provenance: 'fallback' }
    ]);
  });

  it('shows the earlier conversation without the form when read-only', () => {
    render(BriefChat, { lines, turnsLeft: 6, onSend: () => {}, readOnly: true });
    const chat = screen.getByTestId('brief-chat');
    expect(chat.textContent).toContain('Your earlier conversation');
    expect(chat.textContent).toContain('I cook a lot of pasta.');
    expect(chat.textContent).toContain('Basil loves a sunny step.');
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(screen.queryByTestId('brief-turns')).toBeNull();
  });
});
