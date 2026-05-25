/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import WorkflowStrip, { type WorkflowStep } from './WorkflowStrip.svelte';

const STEPS: WorkflowStep[] = [
  { id: 'season-setup', label: 'Season setup', state: 'done', when: 'Apr 2' },
  { id: 'allocation', label: 'Allocation', state: 'done', when: 'Apr 8' },
  { id: 'schedule', label: 'Schedule', state: 'in-progress', when: 'Apr 14' },
  { id: 'inputs', label: 'Inputs plan', state: 'pending' },
  { id: 'commit', label: 'Commit', state: 'pending' }
];

describe('WorkflowStrip', () => {
  it('renders season-year label + workflow title', () => {
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS });
    expect(screen.getByText('Season 2026 plan')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
  });

  it('renders every step with its label + when text', () => {
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS });
    for (const s of STEPS) {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
    expect(screen.getByText('✓ Apr 2')).toBeInTheDocument();
    expect(screen.getByText('Apr 14 · in progress')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('omits CTA when onOpenWizard prop is absent', () => {
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS });
    expect(screen.queryByRole('button', { name: /Open wizard/i })).toBeNull();
  });

  it('renders CTA when onOpenWizard prop provided + fires on click', async () => {
    const onOpenWizard = vi.fn();
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS, onOpenWizard });
    const cta = screen.getByRole('button', { name: /Open wizard/i });
    await fireEvent.click(cta);
    expect(onOpenWizard).toHaveBeenCalledTimes(1);
  });

  it('step buttons fire onSelectStep with the step id when provided', async () => {
    const onSelectStep = vi.fn();
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS, onSelectStep });
    const scheduleBtn = screen.getByText('Schedule').closest('button')!;
    await fireEvent.click(scheduleBtn);
    expect(onSelectStep).toHaveBeenCalledWith('schedule');
  });

  it('step buttons are disabled when no onSelectStep provided (read-only mode)', () => {
    render(WorkflowStrip, { seasonYear: 2026, steps: STEPS });
    const scheduleBtn = screen.getByText('Schedule').closest('button')!;
    expect(scheduleBtn).toBeDisabled();
  });

  it('renders stale state with rust-toned when label', () => {
    const stalesteps: WorkflowStep[] = [{ id: 'a', label: 'A', state: 'stale' }];
    render(WorkflowStrip, { seasonYear: 2026, steps: stalesteps });
    expect(screen.getByText('Stale · refresh')).toBeInTheDocument();
  });
});
