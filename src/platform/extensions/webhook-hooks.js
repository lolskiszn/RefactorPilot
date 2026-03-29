export function createExtensionHookBus() {
  const handlers = new Map();

  return {
    emit(eventName, payload) {
      const listeners = handlers.get(eventName) ?? [];
      return Promise.all(listeners.map((listener) => listener(payload)));
    },
    on(eventName, handler) {
      if (!handlers.has(eventName)) {
        handlers.set(eventName, []);
      }
      handlers.get(eventName).push(handler);
      return () => {
        const next = (handlers.get(eventName) ?? []).filter((entry) => entry !== handler);
        handlers.set(eventName, next);
      };
    },
    registeredEvents() {
      return [...handlers.keys()].sort((left, right) => left.localeCompare(right));
    },
  };
}

export function createPlatformExtensionHost({ hookBus = createExtensionHookBus(), plugins = [] } = {}) {
  return {
    async emitLifecycle(eventName, payload) {
      return hookBus.emit(eventName, payload);
    },
    hookBus,
    async registerPlugin(plugin) {
      const extensionPoints = plugin?.manifest?.capabilities?.extensions ?? [];
      for (const point of extensionPoints) {
        const hook = plugin?.extensions?.[point];
        if (typeof hook === "function") {
          hookBus.on(point, hook);
        }
      }
      plugins.push(plugin);
      return plugin;
    },
    registeredPlugins() {
      return [...plugins];
    },
  };
}
