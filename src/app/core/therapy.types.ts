export interface TherapyConnection {
  id: string;
  therapist_id: string;
  client_id: string;
  user_id: string | null;
  therapist_name: string;
  created_at: string;
  revoked_at: string | null;
}

export interface TherapySession {
  id: string;
  connection_id: string;
  user_id: string;
  therapist_id: string;
  starts_at: string;
  duration_minutes: number;
  status: "scheduled" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface PreSessionNote {
  session_id: string;
  user_id: string;
  body: string;
  status: "draft" | "submitted";
  submitted_at: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export interface TherapyInvite {
  connection: TherapyConnection;
  token: string;
  expires_at: string;
}

export interface SessionInput {
  connection_id: string;
  starts_at: string;
  duration_minutes: number;
  id?: string;
}

export const PRE_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PRE_SESSION_NOTE_LIMIT = 2000;

export function isSessionDue(session: TherapySession, now: number): boolean {
  const start = Date.parse(session.starts_at);
  return session.status === "scheduled" && Number.isFinite(start) && start > now && start - now <= PRE_SESSION_WINDOW_MS;
}

export function validateSessionInput(input: SessionInput, now = Date.now()): SessionInput {
  const start = Date.parse(input.starts_at);
  if (!input.connection_id) throw new Error("Choose a connected therapist or client.");
  const nextYear = new Date(now);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  if (!Number.isFinite(start) || start <= now || start >= nextYear.getTime()) {
    throw new Error("Choose a future session within the next year.");
  }
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes < 15 || input.duration_minutes > 180) {
    throw new Error("Choose a session length between 15 and 180 minutes.");
  }
  return { ...input, starts_at: new Date(start).toISOString() };
}

export function validatePreSessionNote(body: string): string {
  const text = body.trim();
  if (!text) throw new Error("Write something before saving your note.");
  if (text.length > PRE_SESSION_NOTE_LIMIT) throw new Error("Keep your note to 2,000 characters or fewer.");
  return text;
}
