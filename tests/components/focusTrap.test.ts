import { describe, expect, it } from 'vitest';
import { focusTrap } from '../../src/lib/actions/focusTrap';

describe('focusTrap', () => {
  it('focuses the first control after a portaled panel becomes connected', async () => {
    const portalHost = document.createElement('div');
    const panel = document.createElement('div');
    const close = document.createElement('button');
    close.textContent = 'Close';
    panel.appendChild(close);
    portalHost.appendChild(panel);

    const trap = focusTrap(panel);
    document.body.appendChild(portalHost);
    await Promise.resolve();

    expect(document.activeElement).toBe(close);
    trap.destroy();
    portalHost.remove();
  });
});
