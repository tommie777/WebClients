import type { DownloadItem, Event, Session, WebContents } from "electron";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { OrderFileActionResult } from "./orderFilesContract";

type AttachmentInspection = {
    state: "ready" | "expanding" | "missing";
    count: number;
};

const executePageFunction = async <T, TArgs extends unknown[]>(
    contents: WebContents,
    callback: (...args: TArgs) => unknown,
    ...args: TArgs
): Promise<T> => {
    const script = "(" + callback.toString() + ")(" + args.map((argument) => JSON.stringify(argument)).join(",") + ")";
    return (await contents.executeJavaScript(script, true)) as T;
};

function inspectAttachmentsInPage(messageID?: string): AttachmentInspection {
    const visible = (node: Element) => node.getClientRects().length > 0;
    const messages = Array.from(
        document.querySelectorAll<HTMLElement>('[data-shortcut-target="message-container"][data-expanded="true"]'),
    ).filter(visible);
    const target = messageID
        ? messages.find((message) => message.getAttribute("data-message-id") === messageID)
        : [...messages].reverse().find((message) => message.querySelector('[data-testid="attachment-list:header"]'));
    if (!target) return { state: "missing", count: 0 };

    const items = Array.from(target.querySelectorAll<HTMLElement>('[data-testid="attachment-item"]'));
    if (items.length) return { state: "ready", count: items.length };

    const count = Number(
        target.querySelector('[data-testid="attachment-list:pure-attachment-number"]')?.textContent || "0",
    );
    const toggle = target.querySelector('[data-testid="attachment-list:toggle"]');
    if (count > 0 && toggle instanceof HTMLElement) {
        toggle.click();
        return { state: "expanding", count };
    }
    return { state: "missing", count: 0 };
}

function clickAttachmentInPage(messageID: string | undefined, index: number): boolean {
    const visible = (node: Element) => node.getClientRects().length > 0;
    const messages = Array.from(
        document.querySelectorAll<HTMLElement>('[data-shortcut-target="message-container"][data-expanded="true"]'),
    ).filter(visible);
    const target = messageID
        ? messages.find((message) => message.getAttribute("data-message-id") === messageID)
        : [...messages].reverse().find((message) => message.querySelector('[data-testid="attachment-list:header"]'));
    const item = target?.querySelectorAll<HTMLElement>('[data-testid="attachment-item"]')[index];
    if (!item) return false;
    const action =
        item.querySelector<HTMLElement>(".message-attachmentSecondaryAction") ||
        item.querySelector<HTMLElement>('[data-testid$="--primary-action"]');
    if (!action || !visible(action)) return false;
    action.click();
    return true;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let savingMailAttachments = false;

const availableDownloadPath = (directory: string, requestedName: string): string => {
    const safeName =
        Array.from(basename(requestedName))
            .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
            .join("")
            .trim() || "bijlage";
    const extension = extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length) || "bijlage";
    let candidate = join(directory, safeName);
    for (let suffix = 2; existsSync(candidate); suffix += 1) {
        candidate = join(directory, `${stem} (${suffix})${extension}`);
    }
    return candidate;
};

const downloadOneAttachment = async (
    mailSession: Session,
    contents: WebContents,
    directory: string,
    trigger: () => Promise<boolean>,
): Promise<{ ok: boolean; name?: string }> =>
    new Promise((resolve) => {
        let claimed = false;
        let completionTimer: NodeJS.Timeout | undefined;
        const cleanup = () => {
            clearTimeout(startTimer);
            clearTimeout(completionTimer);
            mailSession.off("will-download", handleDownload);
        };
        const handleDownload = (_event: Event, item: DownloadItem, source: WebContents) => {
            if (claimed || source.id !== contents.id) return;
            claimed = true;
            clearTimeout(startTimer);
            const destination = availableDownloadPath(directory, item.getFilename());
            item.setSavePath(destination);
            completionTimer = setTimeout(() => {
                cleanup();
                resolve({ ok: false });
            }, 15 * 60_000);
            item.once("done", (_doneEvent, state) => {
                cleanup();
                resolve(state === "completed" ? { ok: true, name: basename(destination) } : { ok: false });
            });
        };
        const startTimer = setTimeout(() => {
            cleanup();
            resolve({ ok: false });
        }, 2 * 60_000);
        mailSession.on("will-download", handleDownload);
        void trigger()
            .then((clicked) => {
                if (!clicked) {
                    cleanup();
                    resolve({ ok: false });
                }
            })
            .catch(() => {
                cleanup();
                resolve({ ok: false });
            });
    });

export const attachOrderFilesToComposer = async (
    contents: WebContents,
    files: string[],
): Promise<OrderFileActionResult> => {
    if (contents.isDestroyed() || !files.length) {
        return { ok: false, message: "Selecteer eerst één of meer bestanden." };
    }
    const debuggerWasAttached = contents.debugger.isAttached();
    try {
        if (!debuggerWasAttached) contents.debugger.attach("1.3");
        const evaluation = (await contents.debugger.sendCommand("Runtime.evaluate", {
            expression: `(() => {
                const composers = Array.from(document.querySelectorAll("section.composer:not(.composer--is-minimized):not(.composer--is-blur)"))
                    .filter((node) => node.getClientRects().length > 0);
                const composer = composers.at(-1);
                const input = composer?.querySelector('input[type="file"][data-testid="composer-attachments-button"]');
                return input instanceof HTMLInputElement && !input.disabled ? input : null;
            })()`,
            objectGroup: "colorspace-order-files",
            returnByValue: false,
        })) as { result?: { objectId?: string; subtype?: string } };
        const objectId = evaluation.result?.subtype === "null" ? undefined : evaluation.result?.objectId;
        if (!objectId) return { ok: false, message: "Open eerst een antwoord of nieuwe e-mail in Proton." };
        await contents.debugger.sendCommand("DOM.setFileInputFiles", { files, objectId });
        return {
            ok: true,
            message: `${files.length} ${files.length === 1 ? "bestand is" : "bestanden zijn"} aan de e-mail toegevoegd.`,
        };
    } catch {
        return { ok: false, message: "De bestanden konden niet aan de e-mail worden toegevoegd." };
    } finally {
        if (contents.debugger.isAttached()) {
            await contents.debugger
                .sendCommand("Runtime.releaseObjectGroup", {
                    objectGroup: "colorspace-order-files",
                })
                .catch(() => undefined);
            if (!debuggerWasAttached && contents.debugger.isAttached()) contents.debugger.detach();
        }
    }
};

export const saveSelectedMailAttachments = async (
    contents: WebContents,
    directory: string,
    messageID?: string,
): Promise<OrderFileActionResult> => {
    if (contents.isDestroyed()) return { ok: false, message: "Proton Mail is niet beschikbaar." };
    if (savingMailAttachments) {
        return { ok: false, message: "Er worden al e-mailbijlagen in een ordermap opgeslagen." };
    }
    savingMailAttachments = true;
    try {
        let inspection = await executePageFunction<AttachmentInspection, [string | undefined]>(
            contents,
            inspectAttachmentsInPage,
            messageID,
        );
        for (let attempt = 0; inspection.state === "expanding" && attempt < 10; attempt += 1) {
            await delay(100);
            inspection = await executePageFunction<AttachmentInspection, [string | undefined]>(
                contents,
                inspectAttachmentsInPage,
                messageID,
            );
        }
        if (inspection.state !== "ready" || !inspection.count) {
            return { ok: false, message: "De geselecteerde e-mail bevat geen downloadbare bijlagen." };
        }

        const saved: string[] = [];
        for (let index = 0; index < inspection.count; index += 1) {
            const result = await downloadOneAttachment(contents.session, contents, directory, () =>
                executePageFunction<boolean, [string | undefined, number]>(
                    contents,
                    clickAttachmentInPage,
                    messageID,
                    index,
                ),
            );
            if (!result.ok) {
                return {
                    ok: false,
                    message: saved.length
                        ? `${saved.length} bijlagen opgeslagen; de volgende download is niet voltooid.`
                        : "De download is niet gestart. Bevestig eventuele waarschuwing in Proton en probeer opnieuw.",
                };
            }
            if (result.name) saved.push(result.name);
        }
        return {
            ok: true,
            message: `${saved.length} ${saved.length === 1 ? "bijlage is" : "bijlagen zijn"} in de ordermap opgeslagen.`,
        };
    } finally {
        savingMailAttachments = false;
    }
};
