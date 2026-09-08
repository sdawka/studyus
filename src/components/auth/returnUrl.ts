export function safeReturnPath(value: string | null, origin: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function authQuery(params: { returnPath?: string | null; fromDemo?: boolean }): string {
  const query = new URLSearchParams();
  if (params.returnPath) query.set('return', params.returnPath);
  if (params.fromDemo) query.set('from', 'demo');
  const value = query.toString();
  return value ? `?${value}` : '';
}
