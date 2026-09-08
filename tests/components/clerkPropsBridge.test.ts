import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeClerkProps } from '../../src/components/auth/serializeClerkProps';

const bridgePath = resolve(process.cwd(), 'public/clerk-props-bridge.js');

function clerkElement(category: string, id: string, props: Record<string, unknown>): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-clerk-id', id);
  element.setAttribute('data-clerk-component', category);
  element.setAttribute('data-clerk-props', JSON.stringify(props));
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, '__astro_clerk_component_props');
});

describe('Clerk props bridge', () => {
  it('serializes markup-looking Clerk props without HTML-significant characters', () => {
    const props = {
      forceRedirectUrl: '/planner?label=</script><img src=x onerror="window.clerkPropsPwned=true">',
      separator: '\u2028\u2029',
    };

    const serialized = serializeClerkProps(props);

    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toEqual(props);
  });

  it('registers inert JSON props and components introduced after an Astro swap', () => {
    const firstProps = {
      path: '/sign-in',
      signUpUrl: '/sign-up?return=%2Fplanner&from=demo',
      copy: '</script><img src=x onerror="window.clerkBridgeExecuted=true">',
    };
    clerkElement('sign-in', 'clerk-sign-in-first', firstProps);

    new Function(readFileSync(bridgePath, 'utf8'))();

    const map = (window as typeof window & {
      __astro_clerk_component_props: Map<string, Map<string, Record<string, unknown>>>;
    }).__astro_clerk_component_props;
    expect(map.get('sign-in')?.get('clerk-sign-in-first')).toEqual(firstProps);
    expect((window as typeof window & { clerkBridgeExecuted?: boolean }).clerkBridgeExecuted).toBeUndefined();

    const secondProps = { path: '/account', appearance: { elements: { rootBox: 'profile' } } };
    clerkElement('user-profile', 'clerk-user-profile-second', secondProps);
    document.dispatchEvent(new Event('astro:after-swap'));

    expect(map.get('user-profile')?.get('clerk-user-profile-second')).toEqual(secondProps);
  });
});
