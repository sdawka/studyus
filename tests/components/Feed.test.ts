import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StudySessionStub from '../../src/components/feed/StudySessionStub.svelte';

describe('StudySessionStub', () => {
  it('links shared session planning to the working groups surface', () => {
    render(StudySessionStub);

    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByRole('link', { name: /Open study groups/ }).getAttribute('href')).toBe('/groups');
    expect(screen.getByRole('link', { name: 'study flow' }).getAttribute('href')).toBe('/study');
  });
});
