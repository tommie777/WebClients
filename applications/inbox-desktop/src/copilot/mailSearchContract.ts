export const MAIL_SEARCH_STATUS_CHANNEL = "colorspace-mail-search:status";
export const MAIL_SEARCH_OPEN_CHANNEL = "colorspace-mail-search:open";
export const MAIL_SEARCH_ENABLE_CHANNEL = "colorspace-mail-search:enable";

export type MailContentSearchMode = "ready" | "indexing" | "paused" | "disabled" | "not-enabled" | "unavailable";

export type MailContentSearchStatus = {
    mode: MailContentSearchMode;
    progress: number | null;
    indexedMessages: number | null;
    totalMessages: number | null;
    message: string;
};

export type MailSearchActionResult = {
    ok: boolean;
    message: string;
    status?: MailContentSearchStatus;
};
