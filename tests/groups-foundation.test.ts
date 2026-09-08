import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  groupEventRsvps,
  groupEvents,
  groupInvitations,
  groupMembers,
  groupOwnerReassignments,
  groupResources,
  groups,
  users,
} from '../src/db/schema';
import { enqueueAccountDeletion } from '../src/lib/services/accountLifecycle';
import { ConflictError } from '../src/lib/services/util';
import {
  acceptGroupInvitation,
  cancelGroupEvent,
  createGroup,
  createGroupEvent,
  createGroupInvitation,
  createGroupResource,
  deleteGroupResource,
  listGroupMembers,
  listAcceptedGroupEvents,
  listGroupEvents,
  listGroupResources,
  publicGroupEvent,
  publicGroupResource,
  publicGroupSummary,
  removeGroupMember,
  setGroupEventRsvp,
  updateGroupEvent,
  updateGroupResource,
} from '../src/lib/services/groups';

const db = getDb(env.DB);
const HMAC_SECRET = 'test-only-group-invite-hmac-secret-with-32-bytes';

async function user(email: string) {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email, passwordHash: 'x', name: email.split('@')[0] });
  return id;
}

beforeEach(async () => {
  await db.delete(groupOwnerReassignments);
  await db.delete(groupEventRsvps);
  await db.delete(groupEvents);
  await db.delete(groupResources);
  await db.delete(groupInvitations);
  await db.delete(groupMembers);
  await db.delete(groups);
});

describe('invite-only groups', () => {
  it('keeps internal user identifiers out of browser DTOs', () => {
    expect(publicGroupSummary({ id: 'g', name: 'Group', ownerUserId: 'u', state: 'active', revision: 2, createdAt: 1, updatedAt: 2 })).toEqual({ id: 'g', name: 'Group', state: 'active', createdAt: 1, updatedAt: 2 });
    expect(publicGroupResource({ id: 'r', groupId: 'g', authorUserId: 'u', authorLabel: 'Ada', authorDeletedAt: null, url: 'https://example.com', label: 'Link', createdAt: 1 })).not.toHaveProperty('authorUserId');
    expect(publicGroupEvent({ id: 'e', groupId: 'g', hostUserId: 'u', hostLabel: 'Ada', hostDeletedAt: null, title: 'Session', startsAt: 1, endsAt: 2, timezone: 'UTC', state: 'scheduled', createdAt: 1, updatedAt: 1 })).not.toHaveProperty('hostUserId');
  });

  it('binds a single-use invitation to a normalized verified email without storing it', async () => {
    const ownerId = await user(`owner-${crypto.randomUUID()}@test.local`);
    const memberId = await user(`member-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, ownerId, { name: 'Study circle' });
    const invite = await createGroupInvitation(
      db,
      ownerId,
      group.id,
      '  Learner@Example.COM ',
      HMAC_SECRET,
      1_000,
    );

    const stored = (await db.select().from(groupInvitations).where(eq(groupInvitations.id, invite.invitation.id)))[0];
    expect(JSON.stringify(stored)).not.toContain('learner@example.com');
    await expect(
      acceptGroupInvitation(db, memberId, 'someone-else@example.com', invite.token, HMAC_SECRET, 2_000),
    ).rejects.toThrow();
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId))).toEqual([]);

    await acceptGroupInvitation(db, memberId, 'LEARNER@example.com', invite.token, HMAC_SECRET, 2_000);
    await expect(
      acceptGroupInvitation(db, memberId, 'learner@example.com', invite.token, HMAC_SECRET, 2_001),
    ).rejects.toThrow();
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId))).toHaveLength(1);
  });

  it('enforces five owned groups and twenty-five members under concurrent requests', async () => {
    const ownerId = await user(`owner-cap-${crypto.randomUUID()}@test.local`);
    for (let index = 0; index < 5; index += 1) {
      await createGroup(db, ownerId, { name: `Group ${index}` });
    }
    const ownershipRace = await Promise.allSettled([
      createGroup(db, ownerId, { name: 'Overflow A' }),
      createGroup(db, ownerId, { name: 'Overflow B' }),
    ]);
    expect(ownershipRace.every((result) => result.status === 'rejected')).toBe(true);

    const anotherOwner = await user(`owner-members-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, anotherOwner, { name: 'Capacity' });
    const invitees: Array<{ id: string; email: string; token: string }> = [];
    for (let index = 0; index < 25; index += 1) {
      const email = `invite-${crypto.randomUUID()}@test.local`;
      const id = await user(email);
      const invitation = await createGroupInvitation(db, anotherOwner, group.id, email, HMAC_SECRET, 5_000 + index);
      invitees.push({ id, email, token: invitation.token });
    }
    for (const invitee of invitees.slice(0, 24)) {
      await acceptGroupInvitation(db, invitee.id, invitee.email, invitee.token, HMAC_SECRET, 6_000);
    }
    await expect(
      acceptGroupInvitation(db, invitees[24].id, invitees[24].email, invitees[24].token, HMAC_SECRET, 6_001),
    ).rejects.toThrow();
    expect(await db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id))).toHaveLength(25);
  });
});

describe('shared contributions and scheduling', () => {
  it('allows authors to edit their contributions and owners to moderate members', async () => {
    const ownerId = await user(`owner-edit-${crypto.randomUUID()}@test.local`);
    const memberEmail = `member-edit-${crypto.randomUUID()}@test.local`;
    const memberId = await user(memberEmail);
    const group = await createGroup(db, ownerId, { name: 'Moderation' });
    const invite = await createGroupInvitation(db, ownerId, group.id, memberEmail, HMAC_SECRET, 7_000);
    await acceptGroupInvitation(db, memberId, memberEmail, invite.token, HMAC_SECRET, 7_001);
    const resource = await createGroupResource(db, memberId, group.id, { label: 'Draft', url: 'https://example.com/draft' });
    const updated = await updateGroupResource(db, memberId, group.id, resource.id, { label: 'Final' });
    expect(updated.label).toBe('Final');
    const event = await createGroupEvent(db, memberId, group.id, { title: 'Draft session', startsAt: 9_000, endsAt: 10_000, timezone: 'UTC' });
    expect((await updateGroupEvent(db, ownerId, group.id, event.id, { title: 'Moderated session' })).title).toBe('Moderated session');

    const members = await listGroupMembers(db, ownerId, group.id);
    expect(members.map((row) => row.memberId)).toEqual(expect.arrayContaining([ownerId, memberId]));
    await removeGroupMember(db, ownerId, group.id, memberId, 8_000);
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId))).toEqual([]);
    await expect(listGroupResources(db, memberId, group.id)).rejects.toThrow('not found');
    expect(await listGroupResources(db, ownerId, group.id)).toHaveLength(1);
    expect((await db.select().from(groupEvents).where(eq(groupEvents.id, event.id)))[0]?.state).toBe('cancelled');
  });

  it('removes only the target group RSVPs when a member leaves', async () => {
    const ownerId = await user(`owner-scoped-remove-${crypto.randomUUID()}@test.local`);
    const memberId = await user(`member-scoped-remove-${crypto.randomUUID()}@test.local`);
    const first = await createGroup(db, ownerId, { name: 'First group' });
    const second = await createGroup(db, ownerId, { name: 'Second group' });
    await db.insert(groupMembers).values([
      { groupId: first.id, userId: memberId, role: 'member', joinedAt: 1 },
      { groupId: second.id, userId: memberId, role: 'member', joinedAt: 1 },
    ]);
    const firstEvent = await createGroupEvent(db, ownerId, first.id, { title: 'First', startsAt: 10_000, endsAt: 11_000, timezone: 'UTC' });
    const secondEvent = await createGroupEvent(db, ownerId, second.id, { title: 'Second', startsAt: 12_000, endsAt: 13_000, timezone: 'UTC' });
    await setGroupEventRsvp(db, memberId, first.id, firstEvent.id, 'going');
    await setGroupEventRsvp(db, memberId, second.id, secondEvent.id, 'going');

    await removeGroupMember(db, ownerId, first.id, memberId, 2_000);

    const remaining = await db.select().from(groupEventRsvps).where(eq(groupEventRsvps.userId, memberId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.eventId).toBe(secondEvent.id);
  });

  it('returns a domain conflict for one of two concurrent writes from the same revision', async () => {
    const ownerId = await user(`owner-cas-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, ownerId, { name: 'CAS' });
    const results = await Promise.allSettled([
      createGroupResource(db, ownerId, group.id, { label: 'A', url: 'https://example.com/a' }),
      createGroupResource(db, ownerId, group.id, { label: 'B', url: 'https://example.com/b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    expect(await db.select().from(groupResources).where(eq(groupResources.groupId, group.id))).toHaveLength(1);
  });

  it('isolates foreign groups and keeps deleted contributions with a deleted-author label', async () => {
    const ownerId = await user(`owner-shared-${crypto.randomUUID()}@test.local`);
    const contributorEmail = `contributor-${crypto.randomUUID()}@test.local`;
    const contributorId = await user(contributorEmail);
    const outsiderId = await user(`outsider-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, ownerId, { name: 'Shared' });
    const invite = await createGroupInvitation(db, ownerId, group.id, contributorEmail, HMAC_SECRET, 10_000);
    await acceptGroupInvitation(db, contributorId, contributorEmail, invite.token, HMAC_SECRET, 10_001);
    const resource = await createGroupResource(db, contributorId, group.id, {
      label: 'Reference',
      url: 'https://example.com/reference',
    });

    await expect(listGroupResources(db, outsiderId, group.id)).rejects.toThrow('not found');
    await expect(deleteGroupResource(db, outsiderId, group.id, resource.id)).rejects.toThrow('not found');
    await db.update(users).set({ clerkUserId: `clerk-${contributorId}` }).where(eq(users.id, contributorId));
    await enqueueAccountDeletion(db, { eventId: `evt-${contributorId}`, clerkUserId: `clerk-${contributorId}` }, 11_000);

    const retained = await listGroupResources(db, ownerId, group.id);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ authorUserId: null, authorLabel: 'Deleted user' });
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, contributorId))).toEqual([]);
  });

  it('rolls back the complete deletion fence when group retention fails', async () => {
    const ownerId = await user(`owner-rollback-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, ownerId, { name: 'Atomic retention' });
    const clerkUserId = `clerk-${ownerId}`;
    await db.update(users).set({ clerkUserId }).where(eq(users.id, ownerId));
    await env.DB.exec("CREATE TRIGGER fail_group_retention BEFORE UPDATE ON groups BEGIN SELECT RAISE(ABORT, 'synthetic group retention failure'); END;");
    try {
      await expect(enqueueAccountDeletion(db, { eventId: `evt-${ownerId}`, clerkUserId }, 25_000)).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER fail_group_retention');
    }
    expect((await db.select().from(users).where(eq(users.id, ownerId)))[0]?.accountState).toBe('active');
    expect((await db.select().from(groups).where(eq(groups.id, group.id)))[0]).toMatchObject({ ownerUserId: ownerId, state: 'active' });
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, ownerId))).toHaveLength(1);
  });

  it('keeps owner deletion and operator reassignment serializable under a real D1 race', async () => {
    const ownerId = await user(`owner-race-${crypto.randomUUID()}@test.local`);
    const memberId = await user(`member-race-${crypto.randomUUID()}@test.local`);
    const group = await createGroup(db, ownerId, { name: 'Ownership race' });
    await db.insert(groupMembers).values({ groupId: group.id, userId: memberId, role: 'member', joinedAt: 1 });
    const clerkUserId = `clerk-${ownerId}`;
    await db.update(users).set({ clerkUserId }).where(eq(users.id, ownerId));
    const results = await Promise.allSettled([
      enqueueAccountDeletion(db, { eventId: `evt-${ownerId}`, clerkUserId }, 26_000),
      db.insert(groupOwnerReassignments).values({
        id: crypto.randomUUID(),
        groupId: group.id,
        previousOwnerUserId: null,
        newOwnerUserId: memberId,
        operatorLabel: 'race-operator',
        reason: 'Concurrent owner deletion',
        createdAt: 26_001,
      }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    const finalGroup = (await db.select().from(groups).where(eq(groups.id, group.id)))[0];
    if (results[1].status === 'fulfilled') {
      expect(finalGroup).toMatchObject({ ownerUserId: memberId, state: 'active' });
      expect((await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId)))[0]?.role).toBe('owner');
    } else {
      expect(finalGroup).toMatchObject({ ownerUserId: null, state: 'read_only' });
      expect((await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId)))[0]?.role).toBe('member');
    }
  });

  it('makes an ownerless group read-only and cancels future sessions hosted by the deleted owner', async () => {
    const ownerId = await user(`owner-delete-${crypto.randomUUID()}@test.local`);
    const memberEmail = `member-delete-${crypto.randomUUID()}@test.local`;
    const memberId = await user(memberEmail);
    const group = await createGroup(db, ownerId, { name: 'Ownerless' });
    const invite = await createGroupInvitation(db, ownerId, group.id, memberEmail, HMAC_SECRET, 20_000);
    await acceptGroupInvitation(db, memberId, memberEmail, invite.token, HMAC_SECRET, 20_001);
    const event = await createGroupEvent(db, ownerId, group.id, {
      title: 'Tomorrow',
      startsAt: 40_000,
      endsAt: 50_000,
      timezone: 'UTC',
    });
    await db.update(users).set({ clerkUserId: `clerk-${ownerId}` }).where(eq(users.id, ownerId));
    await enqueueAccountDeletion(db, { eventId: `evt-${ownerId}`, clerkUserId: `clerk-${ownerId}` }, 30_000);

    expect((await db.select().from(groups).where(eq(groups.id, group.id)))[0]).toMatchObject({ ownerUserId: null, state: 'read_only' });
    expect((await db.select().from(groupEvents).where(eq(groupEvents.id, event.id)))[0]).toMatchObject({ state: 'cancelled', hostUserId: null, hostLabel: 'Deleted user' });
    await expect(createGroupResource(db, memberId, group.id, { label: 'Late', url: 'https://example.com' })).rejects.toThrow();

    await db.insert(groupOwnerReassignments).values({
      id: crypto.randomUUID(),
      groupId: group.id,
      previousOwnerUserId: null,
      newOwnerUserId: memberId,
      operatorLabel: 'test-operator',
      reason: 'Owner requested deletion',
      createdAt: 31_000,
    });
    expect((await db.select().from(groups).where(eq(groups.id, group.id)))[0]).toMatchObject({ ownerUserId: memberId, state: 'active' });
    expect((await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId)))[0]?.role).toBe('owner');
  });

  it('lists only going scheduled events as personal busy time', async () => {
    const ownerId = await user(`owner-event-${crypto.randomUUID()}@test.local`);
    const memberEmail = `member-event-${crypto.randomUUID()}@test.local`;
    const memberId = await user(memberEmail);
    const group = await createGroup(db, ownerId, { name: 'Events' });
    const invite = await createGroupInvitation(db, ownerId, group.id, memberEmail, HMAC_SECRET, 50_000);
    await acceptGroupInvitation(db, memberId, memberEmail, invite.token, HMAC_SECRET, 50_001);
    const going = await createGroupEvent(db, ownerId, group.id, { title: 'Going', startsAt: 60_000, endsAt: 70_000, timezone: 'UTC' });
    const maybe = await createGroupEvent(db, ownerId, group.id, { title: 'Maybe', startsAt: 80_000, endsAt: 90_000, timezone: 'UTC' });
    await setGroupEventRsvp(db, memberId, group.id, going.id, 'going');
    await setGroupEventRsvp(db, memberId, group.id, maybe.id, 'maybe');
    expect((await listAcceptedGroupEvents(db, memberId, 65_000, 100_000)).map((row) => row.id)).toEqual([going.id]);
    await cancelGroupEvent(db, ownerId, group.id, going.id);
    expect(await listAcceptedGroupEvents(db, memberId, 65_000, 100_000)).toEqual([]);
  });

  it('returns only the authenticated member RSVP with each group event', async () => {
    const ownerId = await user(`owner-rsvp-${crypto.randomUUID()}@test.local`);
    const firstEmail = `first-rsvp-${crypto.randomUUID()}@test.local`;
    const secondEmail = `second-rsvp-${crypto.randomUUID()}@test.local`;
    const firstId = await user(firstEmail);
    const secondId = await user(secondEmail);
    const group = await createGroup(db, ownerId, { name: 'Private RSVP views' });
    const firstInvite = await createGroupInvitation(db, ownerId, group.id, firstEmail, HMAC_SECRET, 100_000);
    await acceptGroupInvitation(db, firstId, firstEmail, firstInvite.token, HMAC_SECRET, 100_001);
    const secondInvite = await createGroupInvitation(db, ownerId, group.id, secondEmail, HMAC_SECRET, 100_002);
    await acceptGroupInvitation(db, secondId, secondEmail, secondInvite.token, HMAC_SECRET, 100_003);
    const event = await createGroupEvent(db, ownerId, group.id, {
      title: 'Member response', startsAt: 110_000, endsAt: 120_000, timezone: 'UTC',
    });
    await setGroupEventRsvp(db, firstId, group.id, event.id, 'going');

    expect((await listGroupEvents(db, firstId, group.id))[0]).toMatchObject({ response: 'going' });
    expect((await listGroupEvents(db, secondId, group.id))[0]).toMatchObject({ response: null });
  });
});
