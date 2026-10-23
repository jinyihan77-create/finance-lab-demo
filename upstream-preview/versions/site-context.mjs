// Relative to this asset, including project-site deployments under a subpath.
const root = new URL('../', import.meta.url);
const key = 'finance-lab-task:' + root.pathname;
export function siteUrl(path) { return new URL(path.replace(/^\//, ''), root).href; }
export function rememberTask(id) {
  try { sessionStorage.setItem(key, id); } catch { /* Storage is optional. */ }
}
export function savedTask() {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
