/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AnimalAddForm from './AnimalAddForm.svelte';
import type { SpeciesOption } from '$lib/animals/display';

const species: SpeciesOption[] = [
  {
    id: 'chicken',
    displayName: 'Chicken',
    label: 'Chickens',
    icon: 'egg',
    groupNoun: 'flock',
    foodProducingDefault: true,
    notForSlaughterToggle: false,
    products: ['eggs', 'meat'],
    explanation: 'Chickens count as food animals because people eat their eggs.'
  },
  {
    id: 'dog',
    displayName: 'Dog',
    label: 'Dogs',
    icon: 'dog',
    groupNoun: 'pack',
    foodProducingDefault: false,
    notForSlaughterToggle: false,
    products: [],
    explanation: 'Dogs are not food animals, so medicine withdrawal times do not apply.'
  }
] as unknown as SpeciesOption[];

const areas = [
  { id: 'coop', name: 'Hen house', kind: 'barn' },
  { id: 'woods', name: 'Woods', kind: 'natural_area' }
];

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === '/api/animal-groups') {
      return new Response(JSON.stringify({ group: { id: 'g1', name: 'Layers' }, warnings: [] }), {
        status: 201
      });
    }
    return new Response(
      JSON.stringify({ animal: { id: 'a1', name: 'Biscuit', tag: null }, warnings: [] }),
      { status: 201 }
    );
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

describe('AnimalAddForm', () => {
  it('asks a helper to go to the owner', () => {
    render(AnimalAddForm, { species, areas, layout: 'farm', canEdit: false, onCreated: vi.fn() });
    expect(screen.getByText(/Ask the owner to add animals/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add this/ })).toBeNull();
  });

  it('pets layout: a name only, no tag field, and never the word livestock', async () => {
    const onCreated = vi.fn();
    render(AnimalAddForm, { species, areas, layout: 'pets', canEdit: true, onCreated });
    await fireEvent.click(screen.getByLabelText(/Dogs/));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Tag/)).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('livestock');
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Biscuit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add this animal' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ speciesId: 'dog', name: 'Biscuit', tag: null });
  });

  it('needs a name or tag for one animal and offers the group instead', async () => {
    render(AnimalAddForm, {
      species,
      areas,
      layout: 'farm',
      canEdit: true,
      initialSpecies: 'dog',
      onCreated: vi.fn()
    });
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Add this animal' }));
    expect(screen.getByRole('alert').textContent).toMatch(
      /or add them as a pack\s+with\s+a\s+count/
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Add as a pack with a count' }));
    expect(screen.getByLabelText('How many?')).toBeInTheDocument();
  });

  it('shows the food chip with its reason, and starts hens as a flock with a count', async () => {
    const onCreated = vi.fn();
    render(AnimalAddForm, { species, areas, layout: 'farm', canEdit: true, onCreated });
    await fireEvent.click(screen.getByLabelText(/Chickens/));
    expect(screen.getByText('Food animal')).toBeInTheDocument();
    expect(screen.getByText(/because people eat their eggs/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('How many?'), { target: { value: '24' } });
    await fireEvent.change(screen.getByLabelText(/Where do they live/), {
      target: { value: 'coop' }
    });
    const options = Array.from(
      (screen.getByLabelText(/Where do they live/) as HTMLSelectElement).options
    ).map((o) => o.value);
    expect(options).not.toContain('woods');
    await fireEvent.click(screen.getByRole('button', { name: 'Name some of them' }));
    await fireEvent.input(screen.getByLabelText('Name 1'), { target: { value: 'Henny' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add this flock' }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ kind: 'group', id: 'g1' }))
    );
    expect(lastBody()).toEqual({
      name: 'Chickens',
      speciesId: 'chicken',
      headCount: 24,
      members: [{ name: 'Henny', tag: null }],
      housingFieldId: 'coop'
    });
  });

  it('adds a new place without submitting the add form', async () => {
    let n = 0;
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      if (String(url) === '/api/fields') {
        n += 1;
        const id = n === 1 ? 'new-coop' : `new-coop-${n}`;
        return new Response(JSON.stringify({ field: { id, name: `Coop ${n + 1}` } }), {
          status: 201
        });
      }
      return new Response(JSON.stringify({ group: { id: 'g1', name: 'Layers' } }), {
        status: 201
      });
    });
    const onCreated = vi.fn();
    const { container } = render(AnimalAddForm, {
      species,
      areas,
      layout: 'farm',
      canEdit: true,
      initialSpecies: 'chicken',
      onCreated
    });
    await fireEvent.input(screen.getByLabelText('How many?'), { target: { value: '24' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add a new place' }));
    expect(container.querySelectorAll('form form')).toHaveLength(0);
    const placeName = screen.getByLabelText('What do you call it?');
    await fireEvent.input(placeName, { target: { value: 'Coop 2' } });
    await fireEvent.keyDown(placeName, { key: 'Enter' });
    await waitFor(() =>
      expect((screen.getByLabelText(/Where do they live/) as HTMLSelectElement).value).toBe(
        'new-coop'
      )
    );
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/fields']);
    await fireEvent.click(screen.getByRole('button', { name: 'Add a new place' }));
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Coop 3' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add this place' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/fields', '/api/fields']);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('farm layout asks for a name or tag and sends the tag', async () => {
    render(AnimalAddForm, {
      species,
      areas,
      layout: 'farm',
      canEdit: true,
      initialSpecies: 'chicken',
      initialMode: 'one',
      onCreated: vi.fn()
    });
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name or tag')).toBeNull();
    expect(screen.getByText(/A name or a tag is enough/)).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText(/^Tag/), { target: { value: '14' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add this animal' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ speciesId: 'chicken', name: null, tag: '14' });
  });
});
