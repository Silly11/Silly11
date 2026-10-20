import type { PlanetId } from "./planets";

export type Role = "user" | "expert" | "admin";
export type Mood = "joy" | "sadness" | "unsaid";
export type Visibility = "private" | "public" | "group";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  premiumUntil: string | null;
  verified: boolean;
  emailVerified?: boolean;
  emailNotifications?: boolean;
  linkedProviders?: string[];
  hasPassword?: boolean;
}
export interface Entry {
  id: string;
  authorId: string;
  displayName: string;
  mood: Mood;
  content: string;
  visibility: Visibility;
  groupId: string | null;
  planetId: PlanetId;
  createdAt: string;
  owned: boolean;
  authorPremium: boolean;
  supportVisible: boolean;
}
export interface Letter {
  id: string;
  content: string;
  deliverAt: string;
  status: "scheduled" | "delivered";
  createdAt: string;
}
export interface ChatMessage {
  id: string;
  kind: "user" | "ai" | "support";
  content: string;
  createdAt: string;
}
export interface ChatState {
  messages: ChatMessage[];
  remaining: number;
  cooldownUntil: string | null;
  status: "ai" | "waiting" | "human";
  ticketId: string | null;
}
export interface Notice {
  id: string;
  text: string;
  read: boolean;
  createdAt: string;
}
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  locked: boolean;
  joined: boolean;
  memberCount: number;
}
export interface ConnectionRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  status: "pending" | "accepted" | "rejected";
  incoming: boolean;
}
export interface SupportTicket {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  status: "waiting" | "human" | "closed";
  assignedTo: string | null;
  overdue: boolean;
}
export interface AppState {
  user: User | null;
  entries: Entry[];
  letters: Letter[];
  chat: ChatState;
  notifications: Notice[];
  groups: Group[];
  requests: ConnectionRequest[];
  staffQueue: SupportTicket[];
  config: {
    aiEnabled: boolean;
    billingEnabled: boolean;
    oauthProviders: string[];
    backupRetentionDays: number;
  };
}
export type ActionName =
  | "entry.create"
  | "entry.delete"
  | "letter.create"
  | "letter.delete"
  | "chat.send"
  | "notifications.read"
  | "group.create"
  | "group.join"
  | "group.delete"
  | "connection.request"
  | "connection.respond"
  | "connection.message"
  | "account.notifications"
  | "support.claim"
  | "support.reply"
  | "support.close"
  | "admin.role"
  | "account.delete";
