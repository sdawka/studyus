import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { serviceErrorResponse } from '../src/lib/apiErrors';

describe('commit-time private account fences', () => {
  it('rolls back a late multi-statement write and preserves retained data', async () => {
    const user = crypto.randomUUID();
    const note = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,1)').bind(user,user+'@test.local','x').run();
    await env.DB.prepare('INSERT INTO notes(id,user_id,title,created_at,updated_at) VALUES(?,?,?,1,1)').bind(note,user,'Retained').run();
    await env.DB.prepare("UPDATE users SET account_state='deleting' WHERE id=?").bind(user).run();
    let denied: unknown;
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO account_deletion_events(event_id,clerk_user_id,received_at) VALUES(?,?,1)').bind('rollback-'+user,user),
        env.DB.prepare('UPDATE notes SET title=? WHERE id=?').bind('Late edit',note),
      ]);
    } catch (error) { denied = error; }
    expect(denied).toBeDefined();
    expect((denied as Error).message).toContain('inactive account');
    expect(serviceErrorResponse(denied).status).toBe(404);
    expect(await env.DB.prepare('SELECT title FROM notes WHERE id=?').bind(note).first()).toEqual({title:'Retained'});
    expect(await env.DB.prepare('SELECT event_id FROM account_deletion_events WHERE event_id=?').bind('rollback-'+user).first()).toBeNull();
    await expect(env.DB.prepare('DELETE FROM notes WHERE id=?').bind(note).run()).rejects.toThrow('inactive account');
    await expect(env.DB.prepare('INSERT INTO notes(id,user_id,title,created_at,updated_at) VALUES(?,?,?,1,1)').bind(crypto.randomUUID(),user,'Late create').run()).rejects.toThrow('inactive account');
  });

  it('allows cleanup only for an attachment deletion admitted before the fence', async () => {
    const user = crypto.randomUUID();
    const course = crypto.randomUUID();
    const ready = crypto.randomUUID();
    const admitted = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,1)').bind(user,`${user}@test.local`,'x').run();
    await env.DB.prepare('INSERT INTO courses(id,user_id,code,slug,title,created_at) VALUES(?,?,?,?,?,1)').bind(course,user,'FENCE','fence-'+course,'Fence').run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attachments(id,user_id,course_id,r2_key,filename,size_bytes,state,updated_at,created_at) VALUES(?,?,?,?,?,1,'ready',1,1)").bind(ready,user,course,`${user}/${ready}`,'ready.txt'),
      env.DB.prepare("INSERT INTO attachments(id,user_id,course_id,r2_key,filename,size_bytes,state,updated_at,created_at) VALUES(?,?,?,?,?,1,'deleting',1,1)").bind(admitted,user,course,`${user}/${admitted}`,'admitted.txt'),
    ]);
    await env.DB.prepare("UPDATE users SET account_state='deleting' WHERE id=?").bind(user).run();

    await expect(env.DB.prepare('DELETE FROM attachments WHERE id=?').bind(ready).run()).rejects.toThrow('inactive account');
    await expect(env.DB.prepare('DELETE FROM attachments WHERE id=?').bind(admitted).run()).resolves.toMatchObject({ meta: { changes: 1 } });
  });
});
