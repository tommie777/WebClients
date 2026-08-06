import { app, net, WebContentsView, type WebContents } from "electron";
import Store from "electron-store";

import type { ElectronNotification } from "@proton/shared/lib/desktop/desktopTypes";

import { appSession } from "../utils/session";
import { mainLogger } from "../utils/log";
import { copilotBackgroundIndexEndpoint, copilotBridgeToken, copilotRequestHeaders } from "./backendConfig";

type PendingIncomingMail = {
    key: string;
    labelID: string;
    elementID: string;
    messageID?: string;
    localID: string;
    receivedAt: string;
    attempts: number;
    nextAttemptAt: number;
};

type QueueStore = { pendingIncomingMail?: PendingIncomingMail[] };

type ExtractedIncomingMail = {
    complete?: unknown;
    subject?: unknown;
    senderEmail?: unknown;
    messages?: unknown;
};

type NormalizedIncomingMail = {
    selection: { labelID: string; elementID: string; messageID?: string };
    subject: string;
    senderEmail: string;
    messages: Array<{
        id?: string;
        direction: "inbound" | "outbound";
        sentAt: string;
        bodyText: string;
    }>;
    relatedConversations: [];
};

const queueStore = new Store<QueueStore>({
    name: "colorspace-copilot-incoming-mail",
    configFileMode: 0o600,
});
const MAX_QUEUE_ITEMS = 200;
const MAX_QUEUE_AGE = 7 * 24 * 60 * 60_000;
let processing = false;
let retryTimer: NodeJS.Timeout | undefined;

const isControlCharacter = (character: string): boolean => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
};

const cleanText = (value: unknown, maximum: number): string =>
    typeof value === "string"
        ? Array.from(value, (character) => (isControlCharacter(character) ? " " : character))
              .join("")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, maximum)
        : "";

const cleanEmail = (value: unknown): string => {
    const email = cleanText(value, 254).toLocaleLowerCase("en-US");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

function extractIncomingMailInPage(): ExtractedIncomingMail {
    const subjectNode = document.querySelector('[data-testid="conversation-header:subject"]');
    const subject = subjectNode?.getAttribute("title") || subjectNode?.textContent || "";
    const containers = Array.from(document.querySelectorAll('[data-shortcut-target="message-container"]'));
    const collapsed = containers.filter((container) => container.getAttribute("data-expanded") !== "true");
    for (const container of collapsed) {
        const header = container.querySelector('[data-testid^="message-header-collapsed:"]');
        if (header instanceof HTMLElement) header.click();
    }
    const messages = containers.flatMap((container) => {
        if (container.getAttribute("data-expanded") !== "true") return [];
        const header = container.querySelector(".message-header-expanded");
        const direction = header?.classList.contains("is-outbound") ? "outbound" : "inbound";
        const bodyHost = container.querySelector('[data-testid="message-content:body"]');
        const frame = bodyHost?.querySelector("iframe");
        let bodyText = "";
        try {
            bodyText = frame?.contentDocument?.body?.innerText || bodyHost?.textContent || "";
        } catch {
            bodyText = bodyHost?.textContent || "";
        }
        if (!bodyText.trim()) return [];
        const addresses = Array.from(header?.querySelectorAll('[title*="@"]') || [])
            .map((node) => node.getAttribute("title") || "")
            .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
        return [
            {
                id: container.getAttribute("data-message-id") || undefined,
                direction,
                sentAt: header?.querySelector("time")?.getAttribute("datetime") || undefined,
                bodyText,
                addresses,
            },
        ];
    });
    const latestInbound = [...messages].reverse().find((message) => message.direction === "inbound");
    return {
        complete: collapsed.length === 0,
        subject,
        senderEmail: latestInbound?.addresses?.[0],
        messages: messages.map(({ addresses, ...message }) => message),
    };
}

const executePageFunction = async <T>(contents: WebContents, callback: () => unknown): Promise<T> =>
    (await contents.executeJavaScript(`(${callback.toString()})()`, true)) as T;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeIncomingMail = (
    value: ExtractedIncomingMail,
    pending: PendingIncomingMail,
): NormalizedIncomingMail | null => {
    if (value.complete === false || !Array.isArray(value.messages)) return null;
    const messages = value.messages.slice(-20).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const record = candidate as Record<string, unknown>;
        const bodyText = cleanText(record.bodyText, 30_000);
        if (!bodyText) return [];
        const id = cleanText(record.id, 256);
        const direction = record.direction === "outbound" ? ("outbound" as const) : ("inbound" as const);
        return [
            {
                ...(id ? { id } : {}),
                direction,
                sentAt: cleanText(record.sentAt, 100) || pending.receivedAt,
                bodyText,
            },
        ];
    });
    const senderEmail = cleanEmail(value.senderEmail);
    if (!senderEmail || !messages.some((message) => message.direction === "inbound")) return null;
    return {
        selection: {
            labelID: pending.labelID,
            elementID: pending.elementID,
            ...(pending.messageID ? { messageID: pending.messageID } : {}),
        },
        subject: cleanText(value.subject, 500) || "Zonder onderwerp",
        senderEmail,
        messages,
        relatedConversations: [],
    };
};

const targetURL = (pending: PendingIncomingMail): string => {
    const params = new URLSearchParams({
        labelID: pending.labelID,
        elementID: pending.elementID,
        ...(pending.messageID ? { messageID: pending.messageID } : {}),
    });
    return `https://mail.proton.me/u/${encodeURIComponent(pending.localID)}/all-mail#${params.toString()}`;
};

const extractInBackground = async (pending: PendingIncomingMail): Promise<NormalizedIncomingMail | null> => {
    const view = new WebContentsView({
        webPreferences: {
            session: appSession(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
        await view.webContents.loadURL(targetURL(pending));
        for (let attempt = 0; attempt < 50; attempt += 1) {
            await wait(attempt === 0 ? 750 : 400);
            try {
                const extracted = await executePageFunction<ExtractedIncomingMail>(
                    view.webContents,
                    extractIncomingMailInPage,
                );
                const normalized = normalizeIncomingMail(extracted, pending);
                if (normalized) return normalized;
            } catch {
                // Proton can still be decrypting or replacing the conversation.
            }
        }
        return null;
    } finally {
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
};

const readQueue = (): PendingIncomingMail[] => {
    const cutoff = Date.now() - MAX_QUEUE_AGE;
    return (queueStore.get("pendingIncomingMail") ?? [])
        .filter((item) => Date.parse(item.receivedAt) >= cutoff)
        .slice(-MAX_QUEUE_ITEMS);
};

const writeQueue = (items: PendingIncomingMail[]) => {
    queueStore.set("pendingIncomingMail", items.slice(-MAX_QUEUE_ITEMS));
};

const retryDelay = (attempts: number) => Math.min(5 * 60_000, 15_000 * 2 ** Math.min(attempts, 4));

const scheduleDrain = (delay = 0) => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void drainQueue(), delay);
};

const drainQueue = async (): Promise<void> => {
    if (processing) return;
    const endpoint = copilotBackgroundIndexEndpoint();
    if (!endpoint || !copilotBridgeToken()) return;
    const queue = readQueue();
    const index = queue.findIndex((item) => item.nextAttemptAt <= Date.now());
    if (index < 0) {
        const next = queue.reduce((earliest, item) => Math.min(earliest, item.nextAttemptAt), Infinity);
        if (Number.isFinite(next)) scheduleDrain(Math.max(1_000, next - Date.now()));
        return;
    }

    processing = true;
    const pending = queue[index];
    try {
        const mail = await extractInBackground(pending);
        if (!mail) throw new Error("Proton conversation was not ready for background extraction");
        const response = await net.fetch(endpoint.toString(), {
            method: "POST",
            headers: copilotRequestHeaders(true),
            body: JSON.stringify({
                type: "proton-mail-background-index",
                version: 1,
                receivedAt: pending.receivedAt,
                selection: mail.selection,
                mail,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Mail Copilot returned HTTP ${response.status}`);
        writeQueue(readQueue().filter((item) => item.key !== pending.key));
        mainLogger.info("Work Copilot indexed an incoming Proton message", pending.elementID);
    } catch (error) {
        const current = readQueue();
        writeQueue(
            current.map((item) =>
                item.key === pending.key
                    ? {
                          ...item,
                          attempts: item.attempts + 1,
                          nextAttemptAt: Date.now() + retryDelay(item.attempts),
                      }
                    : item,
            ),
        );
        mainLogger.warn(
            "Work Copilot will retry incoming Proton extraction",
            error instanceof Error ? error.message : "Unknown error",
        );
    } finally {
        processing = false;
        scheduleDrain(1_000);
    }
};

export const queueIncomingMailForCopilot = (payload: ElectronNotification, localID: string | null): void => {
    if (
        payload.app !== "mail" ||
        !payload.labelID ||
        !payload.elementID ||
        !copilotBackgroundIndexEndpoint() ||
        !copilotBridgeToken()
    )
        return;
    const receivedAt = new Date().toISOString();
    const key = payload.messageID || payload.elementID;
    const current = readQueue().filter((item) => item.key !== key);
    current.push({
        key,
        labelID: payload.labelID,
        elementID: payload.elementID,
        ...(payload.messageID ? { messageID: payload.messageID } : {}),
        localID: localID ?? "0",
        receivedAt,
        attempts: 0,
        nextAttemptAt: Date.now() + 2_000,
    });
    writeQueue(current);
    scheduleDrain(2_000);
};

void app.whenReady().then(() => scheduleDrain(5_000));
