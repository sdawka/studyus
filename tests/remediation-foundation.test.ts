import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('retained account lifecycle foundation', () => {
  it('allows a new active identity with a deleted email without changing retained rows', async () => {
    const id = crypto.randomUUID();
    const next = crypto.randomUUID();
    const email = `${id}@test.local`;
    await env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').bind(id,email,'x',1).run();
    await env.DB.prepare("UPDATE users SET account_state='deleted', deleted_at=2 WHERE id=?").bind(id).run();
    await env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').bind(next,email,'x',3).run();
    const result = await env.DB.prepare('SELECT id,email,account_state FROM users WHERE email=? ORDER BY created_at').bind(email).all();
    expect(result.results).toEqual([{id,email,account_state:'deleted'}, {id:next,email,account_state:'active'}]);
    await expect(env.DB.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),email,'x',4).run()).rejects.toThrow();
  });
  it('keeps a durable internal runtime reference and deletion fence without requiring a live user row', async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO learner_runtime_registry (user_id,object_name,state,updated_at) VALUES (?,?,?,?)').bind(id,`learner:${id}`,'deleted',1).run();
    await env.DB.prepare('INSERT INTO account_deletion_events (event_id,clerk_user_id,received_at) VALUES (?,?,?)').bind('evt-'+id,'clerk-'+id,1).run();
    expect(await env.DB.prepare('SELECT object_name,state FROM learner_runtime_registry WHERE user_id=?').bind(id).first()).toEqual({object_name:`learner:${id}`,state:'deleted'});
  });
});
