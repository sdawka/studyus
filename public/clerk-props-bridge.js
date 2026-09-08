(() => {
  const componentPropMapKey = '__astro_clerk_component_props';
  const bridgeInstalledKey = '__studyus_clerk_props_bridge_installed';
  const supportedComponents = new Set(['sign-in', 'sign-up', 'user-profile', 'user-button']);

  function componentProps() {
    const current = window[componentPropMapKey];
    if (current instanceof Map) return current;
    const next = new Map();
    window[componentPropMapKey] = next;
    return next;
  }

  function register(root = document) {
    const propsByComponent = componentProps();
    root.querySelectorAll('[data-clerk-id][data-clerk-component][data-clerk-props]').forEach((element) => {
      const category = element.getAttribute('data-clerk-component');
      const id = element.getAttribute('data-clerk-id');
      if (!category || !id || !supportedComponents.has(category)) return;

      let props;
      try {
        props = JSON.parse(element.getAttribute('data-clerk-props') || '{}');
      } catch {
        return;
      }
      if (!props || Array.isArray(props) || typeof props !== 'object') return;

      let propsForCategory = propsByComponent.get(category);
      if (!propsForCategory) {
        propsForCategory = new Map();
        propsByComponent.set(category, propsForCategory);
      }
      propsForCategory.set(id, props);
    });
  }

  register();
  if (!window[bridgeInstalledKey]) {
    window[bridgeInstalledKey] = true;
    document.addEventListener('astro:after-swap', () => register());
    document.addEventListener('astro:page-load', () => register());
  }
})();
