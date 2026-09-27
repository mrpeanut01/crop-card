/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AddedWarnings from './AddedWarnings.svelte';

describe('AddedWarnings', () => {
  it('links each tag warning to the animal already using the tag (B-23)', () => {
    render(AddedWarnings, {
      created: {
        kind: 'animal',
        id: 'a2',
        label: 'Tag 14',
        warnings: [{ message: 'Tag 14 is already used by Daisy.', animalId: 'a1' }]
      }
    });
    expect(screen.getByRole('link', { name: 'Tag 14 is already used by Daisy.' })).toHaveAttribute(
      'href',
      '/animals/a1'
    );
    expect(screen.getByRole('link', { name: 'Go to Tag 14' })).toHaveAttribute(
      'href',
      '/animals/a2'
    );
  });
});
