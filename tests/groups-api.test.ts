import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { groupEvents, groupFiles, groupMembers, groupResources, groups, users } from '../src/db/schema';
import { POST as groupsPost } from '../src/pages/api/v1/groups/index';
import { GET as eventsGet } from '../src/pages/api/v1/groups/[id]/events/index';
import { GET as filesGet } from '../src/pages/api/v1/groups/[id]/files/index';
import { GET as resourcesGet } from '../src/pages/api/v1/groups/[id]/resources/index';
import { POST as resourcesPost } from '../src/pages/api/v1/groups/[id]/resources/index';

const db = getDb(env.DB);

async function user() {
  const id = crypto.randomUUID();
  const row = { id, email: `${id}@test.local`, passwordHash: 'x' };
  await db.insert(users).values(row);
  return row;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function invoke(handler: typeof groupsPost, input: Record<string, unknown>) {
  return await handler(input as never) as Response;
}

beforeEach(async () => {
  await db.delete(groupEvents);
  await db.delete(groupFiles);
  await db.delete(groupResources);
  await db.delete(groupMembers);
  await db.delete(groups);
});

describe('group API errors', () => {
  it('returns 404 with no side effects for a foreign group contribution', async () => {
    const owner = await user();
    const outsider = await user();
    const created = await invoke(groupsPost, { request: jsonRequest('https://studyus.test/api/v1/groups', { name: 'Private group' }), locals: { user: owner } });
    const group = (await created.json() as { data: { id: string } }).data;

    const denied = await invoke(resourcesPost as typeof groupsPost, {
      params: { id: group.id },
      request: jsonRequest(`https://studyus.test/api/v1/groups/${group.id}/resources`, { label: 'Injected', url: 'https://example.com' }),
      locals: { user: outsider },
    });

    expect(denied.status).toBe(404);
    expect(await db.select().from(groupResources).where(eq(groupResources.groupId, group.id))).toEqual([]);
    expect((await db.select().from(groups).where(eq(groups.id, group.id)))[0]?.revision).toBe(0);
  });

  it('maps the owned-group quota trigger to 409', async () => {
    const owner = await user();
    for (let index = 0; index < 5; index += 1) {
      const response = await invoke(groupsPost, { request: jsonRequest('https://studyus.test/api/v1/groups', { name: `Group ${index}` }), locals: { user: owner } });
      expect(response.status).toBe(201);
    }
    const response = await invoke(groupsPost, { request: jsonRequest('https://studyus.test/api/v1/groups', { name: 'Overflow' }), locals: { user: owner } });
    expect(response.status).toBe(409);
    expect(await db.select().from(groups).where(eq(groups.ownerUserId, owner.id))).toHaveLength(5);
  });

  it('maps a concurrent group revision conflict to 409 and commits one contribution', async () => {
    const owner = await user();
    const created = await invoke(groupsPost, { request: jsonRequest('https://studyus.test/api/v1/groups', { name: 'Concurrent' }), locals: { user: owner } });
    const group = (await created.json() as { data: { id: string } }).data;
    const responses = await Promise.all([
      invoke(resourcesPost as typeof groupsPost, { params: { id: group.id }, request: jsonRequest('https://studyus.test', { label: 'A', url: 'https://example.com/a' }), locals: { user: owner } }),
      invoke(resourcesPost as typeof groupsPost, { params: { id: group.id }, request: jsonRequest('https://studyus.test', { label: 'B', url: 'https://example.com/b' }), locals: { user: owner } }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(groupResources).where(eq(groupResources.groupId, group.id))).toHaveLength(1);
  });

  it('emits viewer-scoped moderation flags without granting outsider or read-only capabilities', async () => {
    const owner = await user();
    const author = await user();
    const member = await user();
    const outsider = await user();
    const created = await invoke(groupsPost, { request: jsonRequest('https://studyus.test/api/v1/groups', { name: 'Capabilities' }), locals: { user: owner } });
    const group = (await created.json() as { data: { id: string } }).data;
    await db.insert(groupMembers).values([
      { groupId: group.id, userId: author.id, role: 'member', joinedAt: 1 },
      { groupId: group.id, userId: member.id, role: 'member', joinedAt: 2 },
    ]);
    await db.insert(groupResources).values({ id: 'resource-capability', groupId: group.id, authorUserId: author.id, authorLabel: 'Author', url: 'https://example.com/', label: 'Reference' });
    await db.insert(groupFiles).values({ id: 'file-capability', groupId: group.id, authorUserId: author.id, authorLabel: 'Author', r2Key: `groups/${group.id}/file`, filename: 'file.txt', sizeBytes: 4, state: 'ready', createdAt: 3, updatedAt: 3 });
    await db.insert(groupEvents).values({ id: 'event-capability', groupId: group.id, hostUserId: author.id, hostLabel: 'Author', title: 'Review', startsAt: 100, endsAt: 200, timezone: 'UTC', createdAt: 4, updatedAt: 4 });

    const get = async (handler: typeof resourcesGet, viewer: typeof owner) => {
      const response = await invoke(handler as typeof groupsPost, { params: { id: group.id }, locals: { user: viewer } });
      return { response, body: await response.json() as { data: Record<string, Array<Record<string, unknown>>> } };
    };
    const ownerViews = await Promise.all([get(resourcesGet, owner), get(filesGet as typeof resourcesGet, owner), get(eventsGet as typeof resourcesGet, owner)]);
    expect(ownerViews[0].body.data.resources[0]).toMatchObject({ can_edit: true, can_delete: true });
    expect(ownerViews[1].body.data.files[0]).toMatchObject({ can_delete: true });
    expect(ownerViews[2].body.data.events[0]).toMatchObject({ can_edit: true, can_cancel: true });

    const authorViews = await Promise.all([get(resourcesGet, author), get(filesGet as typeof resourcesGet, author), get(eventsGet as typeof resourcesGet, author)]);
    expect(authorViews[0].body.data.resources[0]).toMatchObject({ can_edit: true, can_delete: true });
    expect(authorViews[1].body.data.files[0]).toMatchObject({ can_delete: true });
    expect(authorViews[2].body.data.events[0]).toMatchObject({ can_edit: true, can_cancel: true });

    const memberViews = await Promise.all([get(resourcesGet, member), get(filesGet as typeof resourcesGet, member), get(eventsGet as typeof resourcesGet, member)]);
    expect(memberViews[0].body.data.resources[0]).toMatchObject({ can_edit: false, can_delete: false });
    expect(memberViews[1].body.data.files[0]).toMatchObject({ can_delete: false });
    expect(memberViews[2].body.data.events[0]).toMatchObject({ can_edit: false, can_cancel: false });
    expect((await get(resourcesGet, outsider)).response.status).toBe(404);

    await db.update(groups).set({ ownerUserId: null, state: 'read_only' }).where(eq(groups.id, group.id));
    const readOnly = await get(resourcesGet, owner);
    expect(readOnly.body.data.resources[0]).toMatchObject({ can_edit: false, can_delete: false });
  });
});
