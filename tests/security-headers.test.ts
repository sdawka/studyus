import {describe,it,expect} from 'vitest';
import {withSecurityHeaders,secureResponse} from '../src/lib/securityHeaders';
describe('response security headers',()=>{
  it('redacts thrown failures and protects the resulting private response',async()=>{
    const result=await secureResponse('/api/v1/tasks',async()=>{throw new Error('synthetic-secret');});
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain('synthetic-secret');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
  it('preserves the full native Astro policy and generated hashes',()=>{
    const policy="default-src 'self'; script-src 'sha256-example' 'strict-dynamic'; frame-ancestors 'none'";
    const result=withSecurityHeaders(new Response('page',{headers:{'Content-Security-Policy':policy}}),'/planner');
    expect(result.headers.get('Content-Security-Policy')).toBe(policy);
  });
  it('protects failed private requests and preserves multiple response cookies',()=>{
    const headers=new Headers({'Content-Type':'application/json'});
    headers.append('Set-Cookie','a=1; HttpOnly');headers.append('Set-Cookie','b=2; HttpOnly');
    const result=withSecurityHeaders(new Response('{}',{status:401,headers}),'/api/v1/tasks');
    expect(result.status).toBe(401);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(result.headers.getSetCookie()).toHaveLength(2);
  });
  it('retains public cache policy and wraps immutable redirect headers',()=>{
    const result=withSecurityHeaders(new Response('public',{headers:{'Cache-Control':'public, max-age=60'}}),'/try');
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(withSecurityHeaders(Response.redirect('https://example.com',308),'/account').headers.get('X-Frame-Options')).toBe('DENY');
  });
});
