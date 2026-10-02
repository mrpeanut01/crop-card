/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import WhereWillThisGrow from './WhereWillThisGrow.svelte';

const page = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({ page }));

afterEach(() => {
  page.data = {};
});

describe('WhereWillThisGrow, the one empty state on /plan', () => {
  it('offers the owner the three choices and the planning wizard', async () => {
    const onName = vi.fn();
    const onStartWizard = vi.fn();
    render(WhereWillThisGrow, { props: { onName, onStartWizard } });
    const card = screen.getByTestId('plan-where');
    expect(card).toHaveAttribute('data-variant', 'owner');
    expect(within(card).getByRole('heading', { name: 'Where will this grow?' })).toBeVisible();
    expect(within(card).getByRole('link', { name: /Draw it on the map/ })).toHaveAttribute(
      'href',
      '/plan/farm'
    );
    expect(within(card).getByRole('link', { name: /Sketch it by size/ })).toHaveAttribute(
      'href',
      '/plan/farm?mode=sketch'
    );
    await fireEvent.click(within(card).getByRole('button', { name: /Just give it a name/ }));
    expect(onName).toHaveBeenCalledOnce();
    await fireEvent.click(within(card).getByRole('button', { name: 'Start the planning wizard' }));
    expect(onStartWizard).toHaveBeenCalledOnce();
  });

  it('leaves the wizard button out when no handler is given', () => {
    render(WhereWillThisGrow, { props: { onName: vi.fn() } });
    expect(screen.queryByRole('button', { name: 'Start the planning wizard' })).toBeNull();
  });

  it('names the focused Area and offers it as one bed', async () => {
    const area = { id: 'f1', name: 'Hayfield', kind: 'field' } as never;
    const onWhole = vi.fn();
    render(WhereWillThisGrow, { props: { onName: vi.fn(), focusArea: area, onWhole } });
    expect(
      screen.getByRole('heading', { name: 'Where in Hayfield will this grow?' })
    ).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: /Plant the whole Hayfield/ }));
    expect(onWhole).toHaveBeenCalledWith(area);
  });

  it('gives helpers a status note with no choices and no wizard', () => {
    render(WhereWillThisGrow, { props: { variant: 'helper', onStartWizard: vi.fn() } });
    const card = screen.getByTestId('plan-where');
    expect(card).toHaveAttribute('data-variant', 'helper');
    expect(card).toHaveAttribute('role', 'status');
    expect(within(card).getByText('Plan')).toBeVisible();
    expect(within(card).getByRole('heading', { name: 'Nothing to plan on yet.' })).toBeVisible();
    expect(card).toHaveTextContent('Ask the owner to add where things grow.');
    expect(within(card).queryAllByRole('link')).toHaveLength(0);
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('speaks Spanish', () => {
    page.data = { locale: 'es' };
    render(WhereWillThisGrow, { props: { onName: vi.fn(), onStartWizard: vi.fn() } });
    expect(screen.getByRole('heading', { name: '¿Dónde crecerá esto?' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Iniciar el asistente de planificación' })
    ).toBeVisible();
  });
});
