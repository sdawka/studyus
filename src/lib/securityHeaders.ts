/** Apply to every response, including redirects and authentication failures. */
export async function secureResponse(pathname: string, render: () => Promise<Response>): Promise<Response> {
  try {
    return withSecurityHeaders(await render(), pathname);
  } catch {
    console.error('request_failed');
    const message='The request could not be completed. Please try again.';
    const response=pathname.startsWith('/api/')
      ? Response.json({error:{code:'internal_error',message}},{status:500})
      : new Response(message,{status:500});
    return withSecurityHeaders(response, pathname);
  }
}

export function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  // Script/style hashes are supplied by Astro's build-time CSP. These
  // directives must be response headers: frame-ancestors is ignored in meta.
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  }
  const publicPage=pathname==='/' || pathname==='/compare' || pathname==='/how-it-works' || pathname==='/try' || pathname.startsWith('/try/');
  if (!publicPage && !pathname.startsWith('/_astro/') && !pathname.startsWith('/icons/')) headers.set('Cache-Control','private, no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
