// Capture native networking before the deterministic static-demo adapter loads.
Object.defineProperty(window, 'tinglanFetch', { value: window.fetch.bind(window), writable: false, configurable: false });
