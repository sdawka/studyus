export interface GroupSummary {
  id: string;
  name: string;
  state?: 'active' | 'read_only' | string;
  role?: 'owner' | 'member' | string;
  members?: GroupMember[];
}

export interface GroupMember {
  member_id?: string | null;
  label?: string | null;
  name?: string | null;
  role?: 'owner' | 'member' | string;
}

export interface GroupResource {
  id: string;
  label: string;
  url: string;
  author_label?: string | null;
  author_deleted?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
}

export interface GroupFile {
  id: string;
  filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
  author_label?: string | null;
  author_deleted?: boolean;
  can_delete?: boolean;
}

export interface GroupEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  state?: 'scheduled' | 'cancelled' | string;
  host_label?: string | null;
  host_deleted?: boolean;
  response?: 'going' | 'maybe' | 'declined' | null;
  rsvp?: 'going' | 'maybe' | 'declined' | null;
  can_edit?: boolean;
  can_cancel?: boolean;
}

export interface PrivateAttachment {
  id: string;
  filename: string;
  size_bytes?: number | null;
}

export interface GroupDetailData {
  group: GroupSummary;
  members?: GroupMember[];
  resources?: GroupResource[];
  files?: GroupFile[];
  events?: GroupEvent[];
}
