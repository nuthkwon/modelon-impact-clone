/**
 * Location abstraction so the app can run with real paths (`/workspaces/:id?class=…`, the
 * default with the server) or with hash routing (`#/workspaces/:id?class=…`) for static
 * deployments such as a published artifact, where the page URL cannot change.
 */
let hashMode = false;

export function enableHashRouting(): void {
  hashMode = true;
}

export function isHashRouting(): boolean {
  return hashMode;
}

function hashUrl(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : `/${h}`;
}

/** Current app path (without query). */
export function currentPath(): string {
  if (!hashMode) return window.location.pathname;
  return hashUrl().split('?')[0];
}

/** Current query string including the leading `?` (or empty). */
export function currentSearch(): string {
  if (!hashMode) return window.location.search;
  const i = hashUrl().indexOf('?');
  return i >= 0 ? hashUrl().slice(i) : '';
}

/** Current path + query. */
export function currentUrl(): string {
  return `${currentPath()}${currentSearch()}`;
}

export function pushUrl(url: string): void {
  if (hashMode) window.location.hash = url;
  else window.history.pushState(null, '', url);
}

export function replaceUrl(url: string): void {
  if (hashMode) {
    const target = `#${url}`;
    if (window.location.hash !== target) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${target}`);
  } else window.history.replaceState(window.history.state, '', url);
}

/** Subscribes to navigation changes (back/forward, hash changes). */
export function onNavigate(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener('hashchange', cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener('hashchange', cb);
  };
}
