import { clipboard, net, webContents as electronWebContents, type WebContents } from "electron";
import { mainLogger } from "../utils/log";
import { copilotBridgeToken, copilotRequestHeaders, copilotSelectionEndpoint } from "./backendConfig";

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
    relatedConversations: Array<{
        elementID: string;
        subject: string;
        participants: string;
        sentAt: string;
    }>;
};

type ExtractedMailValue = {
    complete?: unknown;
    subject?: unknown;
    senderEmail?: unknown;
    recipientDomain?: unknown;
    messages?: unknown;
    relatedConversations?: unknown;
};

type InsertDraftAction = {
    type: "insert-draft";
    id: string;
    selectionElementID: string;
    draft: string;
};

type OpenConversationAction = {
    type: "open-conversation";
    id: string;
    selectionElementID: string;
    elementID: string;
};

type CopilotAction = InsertDraftAction | OpenConversationAction;

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

const isControlCharacter = (character: string): boolean => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
};

const safePathSegment = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    try {
        const decoded = decodeURIComponent(value);
        if (
            decoded.length > 256 ||
            Array.from(decoded).some(
                (character) => isControlCharacter(character) || character === "/" || character === "\\",
            )
        ) {
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

const cleanText = (value: unknown, maximum: number): string => {
    return typeof value === "string"
        ? Array.from(value, (character) =>
              isControlCharacter(character) && character !== "\t" && character !== "\n" && character !== "\r"
                  ? " "
                  : character,
          )
              .join("")
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
    if (value.complete === false || !Array.isArray(value.messages)) {
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
    const relatedConversations = Array.isArray(value.relatedConversations)
        ? value.relatedConversations.slice(0, 40).flatMap((candidate) => {
              if (!candidate || typeof candidate !== "object") return [];
              const record = candidate as Record<string, unknown>;
              const elementID = cleanText(record.elementID, 256);
              const subject = cleanText(record.subject, 500);
              if (!elementID || !subject || elementID === selection.elementID) return [];
              return [
                  {
                      elementID,
                      subject,
                      participants: cleanText(record.participants, 500),
                      sentAt: cleanText(record.sentAt, 100),
                  },
              ];
          })
        : [];
    return {
        selection,
        subject: cleanText(value.subject, 500) || "Zonder onderwerp",
        ...(senderEmail ? { senderEmail } : {}),
        ...(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipientDomain) ? { recipientDomain } : {}),
        messages,
        relatedConversations,
    };
};

function extractMailInPage(): ExtractedMailValue {
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
        if (!bodyText.trim()) {
            return [];
        }
        const addressNodes = Array.from(header?.querySelectorAll('[title*="@"]') || []);
        const addresses = addressNodes
            .map((node) => node.getAttribute("title") || "")
            .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
        const sentAt =
            header?.querySelector("time")?.getAttribute("datetime") ||
            header?.querySelector('[data-testid="message:message-header-metas"]')?.textContent ||
            "";
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
    const relatedConversations = Array.from(
        document.querySelectorAll('[data-shortcut-target="item-container"][data-element-id]'),
    ).flatMap((item) => {
        const elementID = item.getAttribute("data-element-id") || "";
        const testID = item.getAttribute("data-testid") || "";
        const subject = testID.startsWith("message-item:") ? testID.slice("message-item:".length) : "";
        if (!elementID || !subject) return [];
        const participants = Array.from(item.querySelectorAll('[title*="@"]'))
            .map((node) => node.getAttribute("title") || "")
            .join(", ");
        const sentAt = item.querySelector("time")?.getAttribute("datetime") || "";
        return [{ elementID, subject, participants, sentAt }];
    });
    return {
        complete: collapsed.length === 0 && messages.length === containers.length,
        subject,
        senderEmail,
        recipientDomain: ownAddress?.split("@")[1],
        messages: messages.map(({ addresses, ...message }) => message),
        relatedConversations,
    };
}

function focusDraftEditorInPage(): boolean {
    const composer = Array.from(
        document.querySelectorAll<HTMLElement>("section.composer:not(.composer--is-minimized):not(.composer--is-blur)"),
    )
        .filter((node) => node.getClientRects().length > 0)
        .at(-1);
    if (!composer) return false;

    const textarea = Array.from(
        composer.querySelectorAll('textarea[data-testid="editor-textarea"], textarea.editor-textarea'),
    )
        .filter((node) => node.getClientRects().length > 0)
        .at(-1);
    if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        return true;
    }

    const frame = Array.from(
        composer.querySelectorAll<HTMLIFrameElement>('iframe[data-testid="rooster-iframe"], iframe'),
    )
        .filter((candidate) => candidate.getClientRects().length > 0)
        .filter((candidate) => {
            try {
                return Boolean(
                    candidate.contentDocument?.getElementById("rooster-editor") ||
                    candidate.contentDocument?.querySelector('[contenteditable]:not([contenteditable="false"])'),
                );
            } catch {
                return false;
            }
        })
        .at(-1);
    if (!(frame instanceof HTMLIFrameElement)) {
        return false;
    }
    const editor =
        frame.contentDocument?.getElementById("rooster-editor") ||
        frame.contentDocument?.querySelector('[contenteditable]:not([contenteditable="false"])');
    if (!(editor instanceof HTMLElement) || !frame.contentDocument) {
        return false;
    }
    editor.focus();
    const selection = frame.contentWindow?.getSelection();
    const range = frame.contentDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
}

function richTextEditorStateInPage(sample: string): { ready: boolean; length: number; startsWithSample: boolean } {
    const normalizedSample = sample.trim().replace(/\s+/g, " ").slice(0, 80);
    const composer = Array.from(
        document.querySelectorAll<HTMLElement>("section.composer:not(.composer--is-minimized):not(.composer--is-blur)"),
    )
        .filter((node) => node.getClientRects().length > 0)
        .at(-1);
    if (!composer) return { ready: false, length: 0, startsWithSample: false };
    const frames = Array.from(composer.querySelectorAll<HTMLIFrameElement>('iframe[data-testid="rooster-iframe"]'))
        .filter((frame) => frame.getClientRects().length > 0)
        .reverse();
    for (const frame of frames) {
        try {
            const editor = frame.contentDocument?.getElementById("rooster-editor");
            if (!(editor instanceof HTMLElement)) continue;
            const normalizedText = (editor.textContent || "").replace(/\s+/g, " ").trim();
            return {
                ready: editor.isContentEditable,
                length: normalizedText.length,
                startsWithSample: Boolean(normalizedSample) && normalizedText.startsWith(normalizedSample),
            };
        } catch {
            // Proton may be replacing the composer frame.
        }
    }
    return { ready: false, length: 0, startsWithSample: false };
}

function focusRichTextEditorInPage(): "ready" | "switching" | "missing" {
    const visible = (node: Element) => node.getClientRects().length > 0;
    const composer = Array.from(
        document.querySelectorAll<HTMLElement>("section.composer:not(.composer--is-minimized):not(.composer--is-blur)"),
    )
        .filter(visible)
        .at(-1);
    if (!composer) return "missing";
    const frames = Array.from(composer.querySelectorAll<HTMLIFrameElement>('iframe[data-testid="rooster-iframe"]'))
        .filter(visible)
        .reverse();
    for (const frame of frames) {
        try {
            const frameDocument = frame.contentDocument;
            const editor = frameDocument?.getElementById("rooster-editor");
            if (!(editor instanceof HTMLElement) || !frameDocument || !editor.isContentEditable) continue;
            editor.focus();
            const selection = frame.contentWindow?.getSelection();
            const range = frameDocument.createRange();
            range.selectNodeContents(editor);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
            return "ready";
        } catch {
            // Proton may be replacing the composer frame.
        }
    }

    const toHtml = Array.from(
        document.querySelectorAll(
            '[data-testid="editor-to-html"], .editor-toolbar-dropdown button, .editor-toolbar-dropdown [role="menuitem"]',
        ),
    )
        .filter(visible)
        .filter((node) => {
            if (node.getAttribute("data-testid") === "editor-to-html") return true;
            const label = (node.textContent || "").trim().toLocaleLowerCase();
            return label === "normal" || label === "normaal";
        })
        .at(-1);
    if (toHtml instanceof HTMLElement) {
        toHtml.click();
        return "switching";
    }

    const plainTextEditor = Array.from(
        composer.querySelectorAll('[data-testid="editor-textarea"], textarea.editor-textarea'),
    )
        .filter(visible)
        .at(-1);
    if (plainTextEditor) {
        const moreOptions = Array.from(
            composer.querySelectorAll(
                '[data-testid="composer:more-options-button"], button.composer-more-dropdown, .composer-more-dropdown button',
            ),
        )
            .filter(visible)
            .at(-1);
        if (moreOptions instanceof HTMLElement) {
            moreOptions.click();
            return "switching";
        }
    }
    return "missing";
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

function installReplyInitiationObserverInPage(selectionElementID: string): boolean {
    const root = document.documentElement;
    root.dataset.colorspaceCopilotSelection = selectionElementID;
    root.dataset.colorspaceCopilotReplyInitiated = "false";
    root.dataset.colorspaceCopilotBaselineReplyComposers = JSON.stringify(
        Array.from(
            document.querySelectorAll<HTMLElement>(
                "section.composer:not(.composer--is-minimized):not(.composer--is-blur)",
            ),
        )
            .filter((node) => node.getClientRects().length > 0)
            .map((node, index) => {
                const subject = node.querySelector<HTMLInputElement>('[data-testid="composer:subject"]')?.value || "";
                return `${node.getAttribute("data-testid") || index}:${subject}`;
            }),
    );
    if (root.dataset.colorspaceCopilotReplyObserverInstalled === "true") return true;

    document.addEventListener(
        "click",
        (event) => {
            const target =
                event.target instanceof Element
                    ? event.target.closest('[data-testid="message-view:reply"], [data-testid="message-view:reply-all"]')
                    : null;
            if (target) document.documentElement.dataset.colorspaceCopilotReplyInitiated = "true";
        },
        true,
    );
    root.dataset.colorspaceCopilotReplyObserverInstalled = "true";
    return true;
}

function replyInitiatedInPage(selectionElementID: string): boolean {
    const root = document.documentElement;
    if (root.dataset.colorspaceCopilotSelection !== selectionElementID) return false;
    if (root.dataset.colorspaceCopilotReplyInitiated === "true") return true;

    let baseline: string[] = [];
    try {
        baseline = JSON.parse(root.dataset.colorspaceCopilotBaselineReplyComposers || "[]") as string[];
    } catch {
        baseline = [];
    }
    return Array.from(
        document.querySelectorAll<HTMLElement>("section.composer:not(.composer--is-minimized):not(.composer--is-blur)"),
    )
        .filter((node) => node.getClientRects().length > 0)
        .some((node, index) => {
            const subject = node.querySelector<HTMLInputElement>('[data-testid="composer:subject"]')?.value || "";
            const signature = `${node.getAttribute("data-testid") || index}:${subject}`;
            return /^\s*re\s*:/i.test(subject) && !baseline.includes(signature);
        });
}

function clickConversationInPage(elementID: string): boolean {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-element-id]'));
    const target = items.find((item) => item.getAttribute("data-element-id") === elementID);
    if (!target || target.getClientRects().length === 0) return false;
    target.click();
    return true;
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
    const type = cleanText(record.type, 50);
    if (type === "open-conversation") {
        const elementID = cleanText(record.elementID, 256);
        return id && selectionElementID && elementID
            ? { type: "open-conversation", id, selectionElementID, elementID }
            : null;
    }
    const draft = cleanText(record.draft, 4_000);
    return id && selectionElementID && draft
        ? { type: "insert-draft", id, selectionElementID, draft }
        : null;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isProtonMailContents = (contents: WebContents): boolean => {
    if (contents.isDestroyed()) return false;
    try {
        const url = new URL(contents.getURL());
        return url.protocol === "https:" && ["mail.proton.me", "mail.proton.dev"].includes(url.hostname);
    } catch {
        return false;
    }
};

const findComposerContents = async (): Promise<WebContents | null> => {
    const candidates = [...electronWebContents.getAllWebContents()]
        .filter(isProtonMailContents)
        .filter((candidate) => candidate.isFocused())
        .sort((left, right) => right.id - left.id);
    for (const candidate of candidates) {
        try {
            if (await executePageFunction<boolean>(candidate, focusDraftEditorInPage)) return candidate;
        } catch {
            // A newly created composer may still be navigating.
        }
    }
    return null;
};

const ensureRichTextEditor = async (contents: WebContents): Promise<boolean> => {
    let readyChecks = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const state = await executePageFunction<"ready" | "switching" | "missing">(contents, focusRichTextEditorInPage);
        if (state === "ready") {
            readyChecks += 1;
            if (readyChecks >= 2) return true;
        } else {
            readyChecks = 0;
        }
        await wait(250);
    }
    return false;
};

const insertDraftInRichTextEditor = async (contents: WebContents, draft: string): Promise<boolean> => {
    const state = () =>
        executePageFunction<{ ready: boolean; length: number; startsWithSample: boolean }, [string]>(
            contents,
            richTextEditorStateInPage,
            draft,
        );
    const before = await state();
    if (!before.ready) return false;

    await executePageFunction<"ready" | "switching" | "missing">(contents, focusRichTextEditorInPage);
    contents.focus();
    await wait(100);
    await contents.insertText(`${draft}\n\n`);
    await wait(750);
    let after = await state();
    if (after.ready && after.startsWithSample && after.length > before.length) return true;

    await executePageFunction<"ready" | "switching" | "missing">(contents, focusRichTextEditorInPage);
    contents.focus();
    const previousClipboard = clipboard.readText();
    const pastedContent = `${draft}\n\n`;
    clipboard.writeText(pastedContent);
    try {
        contents.paste();
        await wait(1_000);
        after = await state();
    } finally {
        if (clipboard.readText() === pastedContent) clipboard.writeText(previousClipboard);
    }
    return after.ready && after.startsWithSample && after.length > before.length;
};

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
    contents: WebContents,
    selection: SelectedMail,
    mail: SelectedMailContent,
    generation: number,
): Promise<void> => {
    const actionEndpoint = new URL("./action", endpoint);
    const actionsWithReplyOpened = new Set<string>();
    let generationRequested = false;
    for (let attempt = 0; attempt < 150 && generation === activeSelectionGeneration; attempt += 1) {
        await wait(2_000);
        try {
            if (!generationRequested) {
                generationRequested = await executePageFunction<boolean, [string]>(
                    contents,
                    replyInitiatedInPage,
                    selection.elementID,
                );
                if (generationRequested) {
                    const generationResponse = await fetch(endpoint, {
                        method: "POST",
                        headers: copilotRequestHeaders(true),
                        body: JSON.stringify({
                            type: "proton-mail-selection",
                            version: 1,
                            selection,
                            mail,
                            generateDraft: true,
                        }),
                        redirect: "error",
                        signal: AbortSignal.timeout(3_000),
                    });
                    if (!generationResponse.ok) {
                        generationRequested = false;
                        mainLogger.warn("Mail Copilot reply trigger returned HTTP", generationResponse.status);
                    }
                }
            }

            const response = await net.fetch(actionEndpoint.toString(), {
                headers: copilotRequestHeaders(),
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

            if (action.type === "open-conversation") {
                const opened = await executePageFunction<boolean, [string]>(
                    contents,
                    clickConversationInPage,
                    action.elementID,
                );
                if (!opened) {
                    mainLogger.warn("Mail Copilot could not open the related Proton conversation");
                    continue;
                }
                await net.fetch(actionEndpoint.toString(), {
                    method: "POST",
                    headers: copilotRequestHeaders(true),
                    body: JSON.stringify({ id: action.id }),
                    redirect: "error",
                    signal: AbortSignal.timeout(1_500),
                });
                return;
            }

            // The action originates in the Copilot WebContentsView, so return
            // keyboard focus to Proton before targeting its nested editor.
            let composerContents = await findComposerContents();
            if (!composerContents && !actionsWithReplyOpened.has(action.id)) {
                actionsWithReplyOpened.add(action.id);
                contents.focus();
                await wait(50);
                await executePageFunction<boolean>(contents, clickReplyInPage);
                for (let composerAttempt = 0; composerAttempt < 20 && !composerContents; composerAttempt += 1) {
                    await wait(250);
                    composerContents = await findComposerContents();
                }
            }
            if (!composerContents) {
                mainLogger.warn("Mail Copilot could not find the Proton reply editor");
                continue;
            }
            composerContents.focus();
            await wait(100);
            if (!(await ensureRichTextEditor(composerContents))) {
                mainLogger.warn("Mail Copilot could not switch the Proton reply editor to rich text");
                continue;
            }
            const inserted = await insertDraftInRichTextEditor(composerContents, action.draft);
            if (!inserted) {
                mainLogger.warn("Mail Copilot could not verify inserted reply text");
                continue;
            }
            await net.fetch(actionEndpoint.toString(), {
                method: "POST",
                headers: copilotRequestHeaders(true),
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
    const endpoint = copilotSelectionEndpoint();
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
        const response = await net.fetch(endpoint.toString(), {
            method: "POST",
            headers: copilotRequestHeaders(true),
            body: JSON.stringify({
                type: "proton-mail-selection",
                version: 1,
                selection,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(1_500),
        });
        if (!response.ok) {
            mainLogger.warn("Mail Copilot selection metadata returned HTTP", response.status);
            return;
        }
        if (!contents || generation !== activeSelectionGeneration) {
            return;
        }

        await executePageFunction<boolean, [string]>(
            contents,
            installReplyInitiationObserverInPage,
            selection.elementID,
        );

        const token = copilotBridgeToken();
        if (!token) {
            return;
        }
        const mail = await extractSelectedMail(contents, selection, generation);
        if (!mail || generation !== activeSelectionGeneration) {
            return;
        }
        const contentResponse = await net.fetch(endpoint.toString(), {
            method: "POST",
            headers: copilotRequestHeaders(true),
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
            void pollForCopilotAction(endpoint, contents, selection, mail, generation);
        } else if (!contentResponse.ok) {
            const details = await contentResponse.json().catch(() => null);
            mainLogger.warn("Mail Copilot mail content returned HTTP", contentResponse.status, details);
        }
    } catch {
        // The local copilot helper is optional and must never interrupt mail.
    }
};
