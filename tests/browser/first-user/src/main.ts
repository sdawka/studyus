import { mount } from 'svelte';
import FirstUserFixture from './FirstUserFixture.svelte';

const view = new URLSearchParams(location.search).get('view') ?? 'onboarding';
if (view === 'onboarding') {
  await Promise.all([
    import('@fontsource-variable/fraunces'),
    import('@fontsource-variable/nunito'),
    import('../../../../src/styles/marketing-rd.css'),
  ]);
} else {
  await import('../../../../src/styles/tokens.css');
  await Promise.all([
    import('../../../../src/styles/fonts/compass.css'),
    import('../../../../src/styles/fonts/focus.css'),
    import('../../../../src/styles/fonts/campus.css'),
  ]);
  // Match the app's cascade deterministically; parallel theme imports can
  // inject Compass's :root defaults after a selected theme's overrides.
  await import('../../../../src/styles/themes/compass.css');
  await import('../../../../src/styles/themes/focus.css');
  await import('../../../../src/styles/themes/campus.css');
  await import('../../../../src/styles/base.css');
}
document.documentElement.dataset.scheme = 'light';
mount(FirstUserFixture, { target: document.getElementById('app')! });
