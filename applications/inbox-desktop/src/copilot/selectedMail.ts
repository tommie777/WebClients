import type { WebContents } from "electron";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mainLogger } from "../utils/log";

export type SelectedMail = {
    labelID: string;
    elementID: string;
    messageID?: string;
};

export type SelectedMailContent = {
    selection: SelectedMail;
    subject: string;
    senderEmail?: string;
    recipientDomain?: string;
    messages: Array<{
        id?: string;
        direction: "inbound" | "outbound";
        sentAt?: string;
        bodyText: string;
    }>;
};

type ExtractedMailValue = {
    subject?: unknown;
    senderEmail?: unknown;
    recipientDomain?: unknown;
    messages?: unknown;
};

type CopilotAction = {
    id: string;
    selectionElementID: string;
    draft: string;
};

type BridgeConfig = {
    selectionURL?: unknown;
    bridgeToken?: unknown;
};

const loadBridgeConfig = (): BridgeConfig => {
    try {
        const configPath = join(
            homedir(),
            "Library",
            "Application Support",
            "Colorspace Proton Copilot",
            "copilot-bridge.json",
        );
        return JSON.parse(readFileSync(configPath, "utf8")) as BridgeConfig;
    } catch {
        return {};
    }
};

const bridgeConfig = loadBridgeConfig();

const RESERVED_MAIL_ROUTES = new Set([
    "account",
    "bookings",
    "eo",
    "login",
    "security-center",
    "settings",
    "signup",
    "upgrade",
]);

const safePathSegment = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    try {
        const decoded = decodeURIComponent(value);
        if (decoded.length > 256 || /[\u0000-\u001f\u007f/\\]/.test(decoded)) {
            return undefined;
        }
        return decoded;
    } catch {
        return undefined;
    }
};

export const selectedMailFromURL = (rawURL: string): SelectedMail | null => {
    let url: URL;
    try {
        url = new URL(rawURL);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" || !["mail.proton.me", "mail.proton.dev"].includes(url.hostname)) {
        return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "u" && /^\d+$/.test(segments[1] ?? "")) {
        segments.splice(0, 2);
    }

    const labelID = safePathSegment(segments[0]);
    const elementID = safePathSegment(segments[1]);
    const messageID = safePathSegment(segments[2]);

    if (!labelID || !elementID || RESERVED_MAIL_ROUTES.has(labelID)) {
        return null;
    }

    return {
        labelID,
        elementID,
        ...(messageID ? { messageID } : {}),
    };
};

const loopbackEndpoint = (): URL | null => {
    const configuredValue = process.env.COLORSPACE_COPILOT_SELECTION_URL ?? bridgeConfig.selectionURL;
    const configured = typeof configuredValue === "string" ? configuredValue.trim() : "";
    if (!configured) {
        return null;
    }

    try {
        const url = new URL(configured);
        const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
        if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) || url.username || url.password) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
};

const bridgeToken = (): string | null => {
    const configuredValue = process.env.COLORSPACE_COPILOT_BRIDGE_TOKEN ?? bridgeConfig.bridgeToken;
    const value = typeof configuredValue === "string" ? configuredValue.trim() : "";
    return value && value.length >= 24 ? value : null;
};

const cleanText = (value: unknown, maximum: number): string => {
    return typeof value === "string"
        ? value
              .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
              .trim()
              .slice(0, maximum)
        : "";
};

const cleanEmail = (value: unknown): string | undefined => {
    const email = cleanText(value, 254).toLocaleLowerCase("en-US");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
};

export const normalizeExtractedMail = (
    value: ExtractedMailValue,
    selection: SelectedMail,
): SelectedMailContent | null => {
    if (!Array.isArray(value.messages)) {
        return null;
    }

    let totalLength = 0;
    const messages = value.messages.slice(-30).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") {
            return [];
        }
        const record = candidate as Record<string, unknown>;
        const direction: "inbound" | "outbound" = record.direction === "outbound" ? "outbound" : "inbound";
        const bodyText = cleanText(record.bodyText, 20_000);
        if (!bodyText || totalLength >= 80_000) {
            return [];
        }
        const boundedBody = bodyText.slice(0, Math.max(0, 80_000 - totalLength));
        totalLength += boundedBody.length;
        const id = cleanText(record.id, 256);
        const sentAt = cleanText(record.sentAt, 100);
        return [
            {
                ...(id ? { id } : {}),
                direction,
                ...(sentAt ? { sentAt } : {}),
                bodyText: boundedBody,
            },
        ];
    });
    if (!messages.length || !messages.some((message) => message.direction === "inbound")) {
        return null;
    }

    const senderEmail = cleanEmail(value.senderEmail);
    const recipientDomain = cleanText(value.recipientDomain, 253).toLocaleLowerCase("en-US");
    return {
        selection,
        subject: cleanText(value.subject, 500) || "Zonder onderwerp",
        ...(senderEmail ? { senderEmail } : {}),
        ...(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipientDomain) ? { recipientDomain } : {}),
        messages,
    };
};

function extractMailInPage(): ExtractedMailValue {
    const subjectNode = document.querySelector('[data-testid="conversation-header:subject"]');
    const subject = subjectNode?.getAttribute("title") || subjectNode?.textContent || "";
    const containers = Array.from(
        document.querySelectorAll('[data-shortcut-target="message-container"][data-expanded="true"]'),
    );
    const messages = containers.flatMap((container) => {
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
        if (!bodyText.trim()) {
            return [];
        }
        const addressNodes = Array.from(header?.querySelectorAll('[title*="@"]') || []);
        const addresses = addressNodes
            .map((node) => node.getAttribute("title") || "")
            .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
        const sentAt = header?.querySelector('[data-testid="message:message-header-metas"]')?.textContent || "";
        return [
            {
                id: container.getAttribute("data-message-id") || undefined,
                direction,
                sentAt,
                bodyText,
                addresses,
            },
        ];
    });
    const latestInbound = [...messages].reverse().find((message) => message.direction === "inbound");
    const senderEmail = latestInbound?.addresses?.[0];
    const ownAddress = messages
        .flatMap((message) => message.addresses || [])
        .find((address) => address !== senderEmail);
    return {
        subject,
        senderEmail,
        recipientDomain: ownAddress?.split("@")[1],
        messages: messages.map(({ addresses, ...message }) => message),
    };
}

function insertDraftInPage(draft: string): boolean {
    const composers = Array.from(document.querySelectorAll('[data-testid^="composer-"]')).filter((node) =>
        node.querySelector('[data-testid="composer-content"]'),
    );
    const composer = composers.at(-1);
    if (!composer) {
        return false;
    }

    const textarea = composer.querySelector('[data-testid="editor-textarea"]');
    if (textarea instanceof HTMLTextAreaElement) {
        const existing = textarea.value.trim();
        const next = existing ? draft + "\n\n" + textarea.value : draft;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, next);
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: draft }));
        textarea.focus();
        textarea.setSelectionRange(draft.length, draft.length);
        return true;
    }

    const frame = composer.querySelector('[data-testid="rooster-iframe"]');
    if (!(frame instanceof HTMLIFrameElement)) {
        return false;
    }
    const editor = frame.contentDocument?.getElementById("rooster-editor");
    if (!(editor instanceof HTMLElement) || !frame.contentDocument) {
        return false;
    }
    const fragment = frame.contentDocument.createDocumentFragment();
    draft.split(/\n/).forEach((line) => {
        const row = frame.contentDocument!.createElement("div");
        row.textContent = line || "\u00a0";
        fragment.append(row);
    });
    if (editor.textContent?.trim()) {
        fragment.append(frame.contentDocument.createElement("br"));
        editor.prepend(fragment);
    } else {
        editor.replaceChildren(fragment);
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: draft }));
    editor.focus();
    return true;
}

function clickReplyInPage(): boolean {
    const messages = Array.from(
        document.querySelectorAll('[data-shortcut-target="message-container"][data-expanded="true"]'),
    );
    const target =
        [...messages].reverse().find((message) => message.querySelector(".message-header-expanded.is-inbound")) ||
        messages.at(-1);
    const reply = target?.querySelector('[data-testid="message-view:reply"]');
    if (reply instanceof HTMLElement) {
        reply.click();
        return true;
    }
    return false;
}

const executePageFunction = async <T, TArgs extends unknown[] = []>(
    contents: WebContents,
    callback: (...args: TArgs) => unknown,
    ...args: TArgs
): Promise<T> => {
    const script = "(" + callback.toString() + ")(" + args.map((argument) => JSON.stringify(argument)).join(",") + ")";
    return (await contents.executeJavaScript(script, true)) as T;
};

const actionFromValue = (value: unknown): CopilotAction | null => {
    if (!value || typeof value !== "object") {
        return null;
    }
    const action = (value as { action?: unknown }).action;
    if (!action || typeof action !== "object") {
        return null;
    }
    const record = action as Record<string, unknown>;
    const id = cleanText(record.id, 100);
    const selectionElementID = cleanText(record.selectionElementID, 256);
    const draft = cleanText(record.draft, 4_000);
    return id && selectionElementID && draft ? { id, selectionElementID, draft } : null;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let activeSelectionGeneration = 0;
let lastScheduledSelection = "";
let lastSubmittedMailFingerprint = "";
let lastSubmittedSelectionKey = "";

const mailFingerprint = (mail: SelectedMailContent): string =>
    JSON.stringify({
        subject: mail.subject,
        senderEmail: mail.senderEmail,
        recipientDomain: mail.recipientDomain,
        messages: mail.messages,
    });

const extractSelectedMail = async (
    contents: WebContents,
    selection: SelectedMail,
    generation: number,
): Promise<SelectedMailContent | null> => {
    const selectionKey = JSON.stringify(selection);
    for (let attempt = 0; attempt < 20 && generation === activeSelectionGeneration; attempt += 1) {
        // The URL changes before Proton replaces the previous conversation in
        // the renderer. Give that transition time and never submit the last
        // successfully handled mail under a newly selected conversation ID.
        await wait(attempt === 0 ? 400 : 250);
        try {
            const value = await executePageFunction<ExtractedMailValue>(contents, extractMailInPage);
            const normalized = normalizeExtractedMail(value, selection);
            if (normalized) {
                const fingerprint = mailFingerprint(normalized);
                if (fingerprint !== lastSubmittedMailFingerprint || selectionKey === lastSubmittedSelectionKey) {
                    return normalized;
                }
            }
        } catch {
            // The renderer may still be replacing the selected conversation.
        }
    }
    return null;
};

const pollForCopilotAction = async (
    endpoint: URL,
    token: string,
    contents: WebContents,
    selection: SelectedMail,
    generation: number,
): Promise<void> => {
    const actionEndpoint = new URL("./action", endpoint);
    for (let attempt = 0; attempt < 150 && generation === activeSelectionGeneration; attempt += 1) {
        await wait(2_000);
        try {
            const response = await fetch(actionEndpoint, {
                headers: { "X-Colorspace-Copilot-Token": token },
                redirect: "error",
                signal: AbortSignal.timeout(1_500),
            });
            if (!response.ok) {
                continue;
            }
            const action = actionFromValue(await response.json());
            if (!action || action.selectionElementID !== selection.elementID) {
                continue;
            }

            let inserted = await executePageFunction<boolean, [string]>(contents, insertDraftInPage, action.draft);
            if (!inserted) {
                await executePageFunction<boolean>(contents, clickReplyInPage);
                for (let composerAttempt = 0; composerAttempt < 12 && !inserted; composerAttempt += 1) {
                    await wait(250);
                    inserted = await executePageFunction<boolean, [string]>(contents, insertDraftInPage, action.draft);
                }
            }
            if (!inserted) {
                continue;
            }
            await fetch(actionEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Colorspace-Copilot-Token": token,
                },
                body: JSON.stringify({ id: action.id }),
                redirect: "error",
                signal: AbortSignal.timeout(1_500),
            });
            return;
        } catch {
            // Copilot is optional and may close while Proton Mail remains open.
        }
    }
};

export const notifyCopilotOfSelectedMail = async (rawURL: string, contents?: WebContents): Promise<void> => {
    const endpoint = loopbackEndpoint();
    const selection = selectedMailFromURL(rawURL);
    if (!endpoint) {
        return;
    }
    if (!selection) {
        lastScheduledSelection = "";
        activeSelectionGeneration += 1;
        return;
    }

    const key = JSON.stringify(selection);
    if (key === lastScheduledSelection) {
        return;
    }
    lastScheduledSelection = key;
    const generation = ++activeSelectionGeneration;

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "proton-mail-selection",
                version: 1,
                selection,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(1_500),
        });
        if (!response.ok) {
            mainLogger.warn("Local Copilot selection metadata returned HTTP", response.status);
            return;
        }
        if (!contents || generation !== activeSelectionGeneration) {
            return;
        }

        const token = bridgeToken();
        if (!token) {
            return;
        }
        const mail = await extractSelectedMail(contents, selection, generation);
        if (!mail || generation !== activeSelectionGeneration) {
            return;
        }
        const contentResponse = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Colorspace-Copilot-Token": token,
            },
            body: JSON.stringify({
                type: "proton-mail-selection",
                version: 1,
                selection,
                mail,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(3_000),
        });
        if (contentResponse.ok && generation === activeSelectionGeneration) {
            lastSubmittedMailFingerprint = mailFingerprint(mail);
            lastSubmittedSelectionKey = key;
            void pollForCopilotAction(endpoint, token, contents, selection, generation);
        } else if (!contentResponse.ok) {
            const details = await contentResponse.json().catch(() => null);
            mainLogger.warn("Local Copilot mail content returned HTTP", contentResponse.status, details);
        }
    } catch {
        // The local copilot helper is optional and must never interrupt mail.
    }
};
