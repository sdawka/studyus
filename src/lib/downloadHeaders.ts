/** Keep untrusted bytes out of the application document origin. */
export function downloadHeaders(filename: string): Record<string, string> {
  const clean = filename.toWellFormed().replace(/[\x00-\x1f\x7f]/g, '').replace(/[\\/]/g, '_').slice(0, 240).toWellFormed() || 'download';
  const fallback = clean.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const extended = fallback !== clean
    ? `; filename*=UTF-8''${encodeURIComponent(clean).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase())}`
    : '';
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${fallback}"${extended}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  };
}
