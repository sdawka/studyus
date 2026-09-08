import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  groupEventRsvps,
  groupEvents,
  groupInvitations,
  groupMembers,
  groupResources,
  groups,
  users,
} from '../../db/schema';
import {
  GROUP_INVITATION_TTL_MS,
  createGroupInvitationSchema,
  createGroupEventSchema,
  createGroupResourceSchema,
  createGroupSchema,
  type CreateGroupEventInput,
  type CreateGroupInput,
  type CreateGroupResourceInput,
  type GroupRsvpResponse,
  type UpdateGroupEventInput,
  type UpdateGroupResourceInput,
  groupRsvpSchema,
  updateGroupEventSchema,
  updateGroupResourceSchema,
} from '../schemas/groups';
import { safeWebUrl } from '../webUrl';
import { ConflictError, NotFoundError, runBatch } from './util';

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function digest(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmac(value: string, secret: string): Promise<string> {
  if (secret.length < 32) throw new TypeError('Group invitation secret is unavailable');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function verifyHmac(value: string, signature: string, secret: string): Promise<boolean> {
  if (secret.length < 32) throw new TypeError('Group invitation secret is unavailable');
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const raw = signature.replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(value));
  } catch {
    return false;
  }
}

export function normalizeGroupInviteEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}

async function emailHash(email: string, secret: string): Promise<string> {
  return hmac(`group-invite-email:${normalizeGroupInviteEmail(email)}`, secret);
}

async function activeUser(db: Db, userId: string) {
  const row = (await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, userId), eq(users.accountState, 'active'))).limit(1))[0];
  if (!row) throw new NotFoundError('Group');
  return row;
}

export async function requireGroupMembership(db: Db, userId: string, groupId: string, writable = false) {
  const row = (await db.select({ group: groups, role: groupMembers.role, name: users.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), eq(users.accountState, 'active')))
    .limit(1))[0];
  if (!row || (writable && (row.group.state !== 'active' || !row.group.ownerUserId))) throw new NotFoundError('Group');
  return row;
}

export function groupMutationFence(db: Db, groupId: string, userId: string, revision: number): BatchItem<'sqlite'> {
  return db.update(groups).set({
    revision: sql`CASE WHEN ${groups.revision} = ${revision}
      AND ${groups.state} = 'active' AND ${groups.ownerUserId} IS NOT NULL
      AND EXISTS (SELECT 1 FROM group_members gm INNER JOIN users u ON u.id=gm.user_id
        WHERE gm.group_id=${groupId} AND gm.user_id=${userId} AND u.account_state='active')
      THEN ${groups.revision} + 1 ELSE -1 END`,
    updatedAt: Date.now(),
  }).where(eq(groups.id, groupId));
}

function errorHas(error: unknown, pattern: RegExp): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if (pattern.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

async function runGroupMutation(db: Db, statements: BatchItem<'sqlite'>[], userId: string, groupId: string) {
  try {
    await runBatch(db, statements);
  } catch (error) {
    if (errorHas(error, /CHECK constraint failed: groups_revision_nonnegative/)) {
      await requireGroupMembership(db, userId, groupId, true);
      throw new ConflictError('Group changed; retry the request');
    }
    throw error;
  }
}

function authorLabel(name: string | null): string {
  return name?.trim().slice(0, 100) || 'Member';
}

export function publicGroupSummary(group: typeof groups.$inferSelect) {
  const { ownerUserId: _ownerUserId, revision: _revision, ...view } = group;
  return view;
}

type GroupResourceView = typeof groupResources.$inferSelect & { canEdit?: boolean; canDelete?: boolean };

export function publicGroupResource(resource: GroupResourceView) {
  const { authorUserId: _authorUserId, authorDeletedAt, canEdit = false, canDelete = false, ...view } = resource;
  return { ...view, authorDeleted: authorDeletedAt !== null, canEdit, canDelete };
}

type GroupEventView = typeof groupEvents.$inferSelect & {
  response?: (typeof groupEventRsvps.$inferSelect)['response'] | null;
  canEdit?: boolean;
  canCancel?: boolean;
};

export function publicGroupEvent(event: GroupEventView) {
  const { hostUserId: _hostUserId, hostDeletedAt, response = null, canEdit = false, canCancel = false, ...view } = event;
  return { ...view, hostDeleted: hostDeletedAt !== null, response, canEdit, canCancel };
}

export async function createGroup(db: Db, userId: string, input: CreateGroupInput) {
  const parsed = createGroupSchema.parse(input);
  await activeUser(db, userId);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await runBatch(db, [
      db.insert(groups).values({ id, name: parsed.name, ownerUserId: userId, state: 'active', revision: 0, createdAt: now, updatedAt: now }),
      db.insert(groupMembers).values({ groupId: id, userId, role: 'owner', joinedAt: now }),
    ]);
  } catch (error) {
    if (errorHas(error, /group owner limit|group member limit/)) {
      await activeUser(db, userId);
      throw new ConflictError('Owned group limit reached');
    }
    throw error;
  }
  return (await db.select().from(groups).where(eq(groups.id, id)).limit(1))[0]!;
}

export async function listGroups(db: Db, userId: string) {
  await activeUser(db, userId);
  return db.select({ group: groups, role: groupMembers.role }).from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId)).orderBy(asc(groups.name));
}

export async function getGroup(db: Db, userId: string, groupId: string) {
  return (await requireGroupMembership(db, userId, groupId)).group;
}

export async function createGroupInvitation(db: Db, userId: string, groupId: string, email: string, secret: string, now = Date.now()) {
  const parsedEmail = createGroupInvitationSchema.parse({ email }).email;
  const member = await requireGroupMembership(db, userId, groupId, true);
  if (member.role !== 'owner') throw new NotFoundError('Group');
  const recipientHash = await emailHash(parsedEmail, secret);
  const id = crypto.randomUUID();
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const tokenSecret = base64Url(random);
  const unsigned = `${id}.${tokenSecret}`;
  const token = `${unsigned}.${await hmac(`group-invite-token:${unsigned}`, secret)}`;
  const invitation = {
    id,
    groupId,
    emailHash: recipientHash,
    tokenHash: await digest(tokenSecret),
    invitedByUserId: userId,
    expiresAt: now + GROUP_INVITATION_TTL_MS,
    createdAt: now,
  };
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.insert(groupInvitations).values(invitation)], userId, groupId);
  return { invitation, token };
}

export async function acceptGroupInvitation(db: Db, userId: string, verifiedEmail: string, token: string, secret: string, now = Date.now()) {
  await activeUser(db, userId);
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(Boolean)) throw new ConflictError('Invitation is invalid or expired');
  const [id, tokenSecret, signature] = parts;
  const unsigned = `${id}.${tokenSecret}`;
  if (!(await verifyHmac(`group-invite-token:${unsigned}`, signature, secret))) throw new ConflictError('Invitation is invalid or expired');
  const tokenDigest = await digest(tokenSecret);
  const recipientHash = await emailHash(verifiedEmail, secret);
  const invite = (await db.select().from(groupInvitations).where(eq(groupInvitations.id, id)).limit(1))[0];
  if (!invite || invite.tokenHash !== tokenDigest || invite.emailHash !== recipientHash || invite.acceptedAt !== null || invite.expiresAt < now) {
    throw new ConflictError('Invitation is invalid or expired');
  }

  try {
    await runBatch(db, [
      db.update(groupInvitations).set({
        acceptedAt: sql`CASE WHEN ${groupInvitations.acceptedAt} IS NULL
          AND ${groupInvitations.tokenHash}=${tokenDigest} AND ${groupInvitations.emailHash}=${recipientHash}
          AND ${groupInvitations.expiresAt} >= ${now}
          THEN ${now} ELSE -1 END`,
        acceptedByUserId: userId,
      }).where(eq(groupInvitations.id, id)),
      db.insert(groupMembers).values({ groupId: invite.groupId, userId, role: 'member', joinedAt: now }),
    ]);
  } catch (error) {
    if (errorHas(error, /group_invitation_acceptance_valid|group member limit or inactive group|UNIQUE constraint failed: group_members\.group_id, group_members\.user_id/)) {
      await activeUser(db, userId);
      const joinable = (await db.select({ id: groups.id }).from(groups)
        .where(and(eq(groups.id, invite.groupId), eq(groups.state, 'active'), sql`${groups.ownerUserId} IS NOT NULL`)).limit(1))[0];
      if (!joinable) throw new NotFoundError('Group');
      throw new ConflictError('Invitation is invalid, expired, or the group is full');
    }
    throw error;
  }
  const accepted = (await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.userId, userId))).limit(1))[0];
  if (!accepted) throw new ConflictError('Invitation is invalid, expired, or the group is full');
  return accepted;
}

export async function createGroupResource(db: Db, userId: string, groupId: string, input: CreateGroupResourceInput) {
  const parsed = createGroupResourceSchema.parse(input);
  const member = await requireGroupMembership(db, userId, groupId, true);
  const normalizedUrl = safeWebUrl(parsed.url)!;
  const id = crypto.randomUUID();
  const row = { id, groupId, authorUserId: userId, authorLabel: authorLabel(member.name), authorDeletedAt: null, url: normalizedUrl, label: parsed.label, createdAt: Date.now() };
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.insert(groupResources).values(row)], userId, groupId);
  return { ...row, canEdit: true, canDelete: true };
}

export async function listGroupResources(db: Db, userId: string, groupId: string) {
  const member = await requireGroupMembership(db, userId, groupId);
  const rows = await db.select().from(groupResources).where(eq(groupResources.groupId, groupId)).orderBy(asc(groupResources.createdAt));
  const writable = member.group.state === 'active' && member.group.ownerUserId !== null;
  return rows.map((resource) => {
    const allowed = writable && (member.role === 'owner' || resource.authorUserId === userId);
    return { ...resource, canEdit: allowed, canDelete: allowed };
  });
}

export async function updateGroupResource(db: Db, userId: string, groupId: string, resourceId: string, input: UpdateGroupResourceInput) {
  const parsed = updateGroupResourceSchema.parse(input);
  const member = await requireGroupMembership(db, userId, groupId, true);
  const resource = (await db.select().from(groupResources).where(and(eq(groupResources.id, resourceId), eq(groupResources.groupId, groupId))).limit(1))[0];
  if (!resource || (member.role !== 'owner' && resource.authorUserId !== userId)) throw new NotFoundError('Group resource');
  await runGroupMutation(db, [
    groupMutationFence(db, groupId, userId, member.group.revision),
    db.update(groupResources).set({
      ...(parsed.label !== undefined ? { label: parsed.label } : {}),
      ...(parsed.url !== undefined ? { url: safeWebUrl(parsed.url)! } : {}),
    }).where(and(eq(groupResources.id, resourceId), eq(groupResources.groupId, groupId))),
  ], userId, groupId);
  return { ...(await db.select().from(groupResources).where(eq(groupResources.id, resourceId)).limit(1))[0]!, canEdit: true, canDelete: true };
}

export async function deleteGroupResource(db: Db, userId: string, groupId: string, resourceId: string) {
  const member = await requireGroupMembership(db, userId, groupId, true);
  const resource = (await db.select().from(groupResources).where(and(eq(groupResources.id, resourceId), eq(groupResources.groupId, groupId))).limit(1))[0];
  if (!resource || (member.role !== 'owner' && resource.authorUserId !== userId)) throw new NotFoundError('Group resource');
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.delete(groupResources).where(and(eq(groupResources.id, resourceId), eq(groupResources.groupId, groupId)))], userId, groupId);
}

export async function createGroupEvent(db: Db, userId: string, groupId: string, input: CreateGroupEventInput) {
  const parsed = createGroupEventSchema.parse(input);
  const member = await requireGroupMembership(db, userId, groupId, true);
  const now = Date.now();
  const row = { id: crypto.randomUUID(), groupId, hostUserId: userId, hostLabel: authorLabel(member.name), hostDeletedAt: null, ...parsed, state: 'scheduled' as const, createdAt: now, updatedAt: now };
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.insert(groupEvents).values(row)], userId, groupId);
  return { ...row, canEdit: true, canCancel: true };
}

export async function listGroupEvents(db: Db, userId: string, groupId: string) {
  const member = await requireGroupMembership(db, userId, groupId);
  const rows = await db.select({ event: groupEvents, response: groupEventRsvps.response })
    .from(groupEvents)
    .leftJoin(groupEventRsvps, and(
      eq(groupEventRsvps.eventId, groupEvents.id),
      eq(groupEventRsvps.userId, userId),
    ))
    .where(eq(groupEvents.groupId, groupId))
    .orderBy(asc(groupEvents.startsAt));
  const writable = member.group.state === 'active' && member.group.ownerUserId !== null;
  return rows.map(({ event, response }) => {
    const allowed = writable && (member.role === 'owner' || event.hostUserId === userId);
    return { ...event, response, canEdit: allowed, canCancel: allowed };
  });
}

export async function updateGroupEvent(db: Db, userId: string, groupId: string, eventId: string, input: UpdateGroupEventInput) {
  const parsed = updateGroupEventSchema.parse(input);
  const member = await requireGroupMembership(db, userId, groupId, true);
  const event = (await db.select().from(groupEvents).where(and(eq(groupEvents.id, eventId), eq(groupEvents.groupId, groupId))).limit(1))[0];
  if (!event || (member.role !== 'owner' && event.hostUserId !== userId)) throw new NotFoundError('Group event');
  const merged = createGroupEventSchema.parse({
    title: parsed.title ?? event.title,
    startsAt: parsed.startsAt ?? event.startsAt,
    endsAt: parsed.endsAt ?? event.endsAt,
    timezone: parsed.timezone ?? event.timezone,
  });
  await runGroupMutation(db, [
    groupMutationFence(db, groupId, userId, member.group.revision),
    db.update(groupEvents).set({ ...merged, updatedAt: Date.now() }).where(and(eq(groupEvents.id, eventId), eq(groupEvents.groupId, groupId))),
  ], userId, groupId);
  return { ...(await db.select().from(groupEvents).where(eq(groupEvents.id, eventId)).limit(1))[0]!, canEdit: true, canCancel: true };
}

export async function listGroupMembers(db: Db, userId: string, groupId: string) {
  await requireGroupMembership(db, userId, groupId);
  const rows = await db.select({ memberId: groupMembers.userId, role: groupMembers.role, name: users.name })
    .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), eq(users.accountState, 'active')))
    .orderBy(asc(groupMembers.joinedAt));
  return rows.map((row) => ({ memberId: row.memberId, role: row.role, label: authorLabel(row.name) }));
}

export async function removeGroupMember(db: Db, userId: string, groupId: string, memberId: string, now = Date.now()) {
  const actor = await requireGroupMembership(db, userId, groupId, true);
  const target = (await db.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId))).limit(1))[0];
  if (!target || target.role === 'owner' || (actor.role !== 'owner' && memberId !== userId)) throw new NotFoundError('Group member');
  await runGroupMutation(db, [
    groupMutationFence(db, groupId, userId, actor.group.revision),
    db.update(groupEvents).set({ state: 'cancelled', updatedAt: now })
      .where(and(eq(groupEvents.groupId, groupId), eq(groupEvents.hostUserId, memberId), eq(groupEvents.state, 'scheduled'), gt(groupEvents.startsAt, now))),
    db.delete(groupEventRsvps).where(and(
      eq(groupEventRsvps.userId, memberId),
      sql`EXISTS (SELECT 1 FROM group_events ge WHERE ge.id=${groupEventRsvps.eventId} AND ge.group_id=${groupId})`,
    )),
    db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId), eq(groupMembers.role, 'member'))),
  ], userId, groupId);
}

export async function cancelGroupEvent(db: Db, userId: string, groupId: string, eventId: string) {
  const member = await requireGroupMembership(db, userId, groupId, true);
  const event = (await db.select().from(groupEvents).where(and(eq(groupEvents.id, eventId), eq(groupEvents.groupId, groupId))).limit(1))[0];
  if (!event || (member.role !== 'owner' && event.hostUserId !== userId)) throw new NotFoundError('Group event');
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.update(groupEvents).set({ state: 'cancelled', updatedAt: Date.now() }).where(eq(groupEvents.id, eventId))], userId, groupId);
}

export async function setGroupEventRsvp(db: Db, userId: string, groupId: string, eventId: string, response: GroupRsvpResponse) {
  groupRsvpSchema.parse({ response });
  const member = await requireGroupMembership(db, userId, groupId, true);
  const event = (await db.select().from(groupEvents).where(and(eq(groupEvents.id, eventId), eq(groupEvents.groupId, groupId), eq(groupEvents.state, 'scheduled'))).limit(1))[0];
  if (!event) throw new NotFoundError('Group event');
  const now = Date.now();
  await runGroupMutation(db, [groupMutationFence(db, groupId, userId, member.group.revision), db.insert(groupEventRsvps).values({ eventId, userId, response, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [groupEventRsvps.eventId, groupEventRsvps.userId], set: { response, updatedAt: now } })], userId, groupId);
  return { eventId, userId, response };
}

export async function listAcceptedGroupEvents(db: Db, userId: string, from: number, to: number) {
  await activeUser(db, userId);
  return db.select({ id: groupEvents.id, groupId: groupEvents.groupId, title: groupEvents.title, startsAt: groupEvents.startsAt, endsAt: groupEvents.endsAt, timezone: groupEvents.timezone })
    .from(groupEventRsvps)
    .innerJoin(groupEvents, eq(groupEvents.id, groupEventRsvps.eventId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groupEvents.groupId), eq(groupMembers.userId, userId)))
    .where(and(eq(groupEventRsvps.userId, userId), eq(groupEventRsvps.response, 'going'), eq(groupEvents.state, 'scheduled'), gt(groupEvents.endsAt, from), lt(groupEvents.startsAt, to)))
    .orderBy(asc(groupEvents.startsAt));
}
