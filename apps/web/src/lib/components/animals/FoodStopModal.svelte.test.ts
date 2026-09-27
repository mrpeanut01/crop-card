/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import FoodStopModal from './FoodStopModal.svelte';

const noop = () => {};

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

describe('FoodStopModal', () => {
  it('offers the grazing-time step when a withdrawal stop also needs it', () => {
    render(FoodStopModal, {
      stop: {
        code: 'WITHDRAWAL_ACTIVE',
        error: 'Held. Save as discarded instead.',
        clearsOn: null,
        holdEndsOn: null,
        nextStep: 'add-grazing-time',
        grazingFieldIds: ['f1']
      },
      isOwner: true,
      onDiscard: noop,
      onClose: noop
    });
    expect(screen.getByRole('link', { name: 'Add the grazing time from the label' })).toBeTruthy();
  });

  it('tells a helper to ask the owner', () => {
    render(FoodStopModal, {
      stop: {
        code: 'WITHDRAWAL_ACTIVE',
        error: 'Held.',
        nextStep: 'add-grazing-time',
        grazingFieldIds: ['f1']
      },
      isOwner: false,
      onDiscard: noop,
      onClose: noop
    });
    expect(screen.getByText('Ask the owner to add the grazing time from the label.')).toBeTruthy();
  });
});
