// §3.9 Full JSON export types.

export interface FullExportPayload {
  exported_at: string;
  user: {
    email: string;
    name: string;
    avatar_url: string | null;
    notification_preferences: Record<string, unknown> | null;
    preferences: Record<string, unknown> | null;
    created_at: string | null;
  };
  collections: Record<string, unknown>;
}

export interface DeleteAccountResult {
  deleted: boolean;
}