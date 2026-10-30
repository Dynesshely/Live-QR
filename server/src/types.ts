import type { WebSocket } from 'ws';

// Re-export config type (defined with zod in config.ts)
export type { AppConfig } from './config.js';

// ── Channel State ──

/** Per-viewer metadata captured at the WS handshake (audit recipients). */
export interface ViewerInfo {
  ip: string;
  ua: string;
  connectedAt: number; // ms timestamp
}

export interface ChannelState {
  shareCode: string;
  latestText: string | null;
  lastUploadAt: number; // ms timestamp, refreshed on every upload (TTL anchor)
  createdAt: number; // ms timestamp
  ttlSeconds: number; // per-channel TTL, frozen at creation time
  uploadWindow: number[]; // timestamps in last 1s for sliding-window rate limit
  wsClients: Set<WebSocket>;
  /** wsClients companion map: who is behind each socket (audit recipients). */
  viewerInfo: Map<WebSocket, ViewerInfo>;
}

// ── API Responses ──

export interface CreateChannelData {
  shareCode: string;
  expireAt: string; // ISO 8601
  createdAt: string; // ISO 8601
}

export interface CreateChannelResponse {
  code: 201;
  data: CreateChannelData;
}

export interface VerifyChannelResponse {
  code: 200;
  valid: true;
  latestText: string | null;
  updatedAt: string | null; // ISO 8601 or null if no text
}

export interface UploadResponse {
  code: 200;
  message: 'ok';
}

export interface ErrorResponse {
  code: number;
  error: string;
  message: string;
}

// ── WebSocket Messages (Server → Client) ──

export interface WelcomeMessage {
  type: 'welcome';
  shareCode: string;
  viewerCount: number;
}

export interface TextMessage {
  type: 'text';
  data: string;
  timestamp: number; // Unix ms
}

export interface HistoryMessage {
  type: 'history';
  messages: Array<{ data: string; timestamp: number }>;
}

/** Broadcast on every viewer join/leave. */
export interface ViewerCountMessage {
  type: 'viewer_count';
  count: number;
}

/**
 * Sent right before the server closes the channel's sockets.
 * `code` is the stable contract for clients; `message` is kept for
 * backwards compatibility only and must not be used for UI copy.
 */
export interface ChannelExpiredMessage {
  type: 'channel_expired';
  code: 'CHANNEL_EXPIRED';
  message: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  serverTime: number; // Unix ms
}

export type ServerMessage =
  | WelcomeMessage
  | TextMessage
  | HistoryMessage
  | ViewerCountMessage
  | ChannelExpiredMessage
  | HeartbeatMessage;

// ── WebSocket Messages (Client → Server) ──

export interface PongMessage {
  type: 'pong';
}

export type ClientMessage = PongMessage;

// ── Audit Log (on-disk JSONL, retained for AUDIT_LOG_RETENTION_DAYS) ──
//
// One JSON object per line in <AUDIT_LOG_DIR>/transfer-YYYY-MM-DD.jsonl
// (UTC date). Field names are a shared three-party contract: do not rename.

export interface AuditUploadRecord {
  type: 'upload';
  ts: string; // ISO 8601
  shareCode: string;
  uploaderIp: string;
  uploaderUa: string;
  text: string; // the exact text that was broadcast (no trim, no truncation)
  textLength: number; // Unicode code points
  recipients: Array<{ ip: string; ua: string }>; // viewers online at broadcast time
}

export interface AuditViewerConnectRecord {
  type: 'viewer_connect';
  ts: string;
  shareCode: string;
  ip: string;
  ua: string;
}

export interface AuditViewerDisconnectRecord {
  type: 'viewer_disconnect';
  ts: string;
  shareCode: string;
  ip: string;
  durationMs: number;
}

export interface AuditStartedRecord {
  type: 'audit_started';
  ts: string;
  dir: string; // absolute directory the records are written to
  retentionDays: number;
}

export interface AuditRetentionPurgeRecord {
  type: 'retention_purge';
  ts: string;
  cutoff: string; // YYYY-MM-DD; files strictly older than this are deleted
  deleted: string[]; // file names removed by this purge
}

export type AuditRecord =
  | AuditUploadRecord
  | AuditViewerConnectRecord
  | AuditViewerDisconnectRecord
  | AuditStartedRecord
  | AuditRetentionPurgeRecord;

// ── Logger ──

export type LogEvent =
  | 'channel_created'
  | 'channel_create_failed'
  | 'channel_verified'
  | 'upload_success'
  | 'upload_rate_limited'
  | 'verify_rate_limited'
  | 'create_rate_limited'
  | 'upload_channel_not_found'
  | 'validation_failed'
  | 'ws_connected'
  | 'ws_disconnected'
  | 'ws_rejected'
  | 'channel_cleaned'
  | 'server_start'
  | 'server_shutdown'
  | 'server_error'
  | 'internal_error'
  | 'access'
  | 'audit_write_failed'
  | 'audit_purge';

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: LogEvent;
  message: string;
  shareCode?: string;
  clientIp?: string;
  // access-log only
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  userAgent?: string;
}
