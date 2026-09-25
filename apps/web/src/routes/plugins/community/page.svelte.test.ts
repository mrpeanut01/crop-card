/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Page from './+page.svelte';

describe('/plugins/community (#234)', () => {
  it('is not a "Not yet open" dead end', () => {
    const { queryByText } = render(Page);
    expect(queryByText(/not yet open/i)).toBeNull();
  });

  it('offers actionable next steps to working routes', () => {
    const { getByTestId, getByText } = render(Page);
    expect(getByTestId('community-upload').getAttribute('href')).toBe('/plugins');
    expect(getByTestId('community-catalog').getAttribute('href')).toBe(
      '/inventory?type=crop&mode=catalog'
    );
    expect(
      getByText(/Author a plugin/)
        .closest('a')
        ?.getAttribute('href')
    ).toBe('/plugins/new');
  });

  it('states honestly that the marketplace is not connected yet', () => {
    const { getByText } = render(Page);
    expect(getByText(/does not connect to it yet/)).toBeInTheDocument();
  });
});
