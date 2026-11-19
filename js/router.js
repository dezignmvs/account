export function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/dashboard";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const query = new URLSearchParams(queryPart || "");
  return { path, query };
}

export function matchRoute(path, routes) {
  for (const route of routes) {
    if (route.path === path) {
      return { route, params: {} };
    }
    const routeParts = route.path.split("/").filter(Boolean);
    const pathParts = path.split("/").filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (routeParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

export function navigate(path) {
  window.location.hash = `#${path.startsWith("/") ? path : `/${path}`}`;
}
