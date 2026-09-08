import { render, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ResourceTile from '../../src/components/course/ResourceTile.svelte';
import ResourceCard from '../../src/components/feed/ResourceCard.svelte';
import ResourceAnalyticsLink from '../../src/components/course/ResourceAnalyticsLink.svelte';

describe('retained invalid resource links', () => {
  it.each([ResourceTile, ResourceCard])('never navigates or fetches external icons for an unsafe stored resource', async (Component) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = render(Component as any, { props: { resource: { id: 'r', label: 'Old link', url: 'javascript:alert(1)', pinned: false, kind: 'user_shared' }, origin: 'course' } });
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.textContent).toContain('HTTP or HTTPS');
    await fireEvent.click(container.querySelector('article')!);
    await fireEvent.keyDown(container.querySelector('article')!, { key: 'Enter' });
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector('img[src^="https://www.google.com"]')).toBeNull();
    open.mockRestore();
  });
  it('does not render unsafe concept-resource anchors', () => {
    const { container } = render(ResourceAnalyticsLink, { props: { resourceId: 'r', href: 'data:text/html,active', label: 'Old link', origin: 'course' } });
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('HTTP or HTTPS');
  });
});
