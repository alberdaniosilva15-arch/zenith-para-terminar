if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister();
    });
  });

  if ('caches' in globalThis) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        caches.delete(name);
      });
    });
  }
}

if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    document.documentElement.classList.add('fonts-ready');
  });
} else {
  setTimeout(() => {
    document.documentElement.classList.add('fonts-ready');
  }, 1500);
}
