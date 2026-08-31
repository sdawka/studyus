import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Smoke from './__fixtures__/Smoke.svelte';

describe('dom test harness', () => {
  it('mounts a Svelte 5 runes component and reads props', () => {
    render(Smoke, { props: { name: 'studyus' } });
    expect(screen.getByRole('button').textContent).toContain('hello studyus 0');
  });
});
