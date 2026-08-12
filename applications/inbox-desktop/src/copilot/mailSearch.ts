import type { WebContents } from "electron";

import type { MailContentSearchStatus, MailSearchActionResult } from "./mailSearchContract";

const unavailableStatus = (message = "Proton Mail is nog niet beschikbaar."): MailContentSearchStatus => ({
    mode: "unavailable",
    progress: null,
    indexedMessages: null,
    totalMessages: null,
    message,
});

export const normalizeMailOrderQuery = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().normalize("NFKC").replace(/^#\s*/, "");
    if (
        normalized.length < 3 ||
        normalized.length > 40 ||
        !/^[a-z\d][a-z\d._/-]*$/i.test(normalized) ||
        !/\d/.test(normalized)
    ) {
        return null;
    }
    return normalized;
};

export const mailOrderSearchURL = (currentURL: string, query: string): string | null => {
    const normalized = normalizeMailOrderQuery(query);
    if (!normalized) return null;
    try {
        const url = new URL(currentURL);
        if (url.protocol !== "https:" || !["mail.proton.me", "mail.proton.dev"].includes(url.hostname)) return null;
        const localID = url.pathname.match(/^\/u\/([^/]+)/)?.[1];
        url.pathname = localID ? `/u/${encodeURIComponent(decodeURIComponent(localID))}/all-mail` : "/all-mail";
        url.search = "";
        url.hash = new URLSearchParams({ keyword: normalized }).toString();
        return url.toString();
    } catch {
        return null;
    }
};

const readSearchStatusInPage = async (): Promise<MailContentSearchStatus> => {
    const requestValue = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    const databases = await indexedDB.databases().catch(() => []);
    const legacyNames = databases.flatMap(({ name }) => (name && /^ES:.*:DB$/.test(name) ? [name] : []));

    const statuses: MailContentSearchStatus[] = [];
    for (const name of legacyNames) {
        try {
            const database = await requestValue(indexedDB.open(name));
            if (
                !database.objectStoreNames.contains("config") ||
                !database.objectStoreNames.contains("indexingProgress")
            ) {
                database.close();
                continue;
            }
            const stores = ["config", "indexingProgress"];
            if (database.objectStoreNames.contains("metadata")) stores.push("metadata");
            if (database.objectStoreNames.contains("content")) stores.push("content");
            const transaction = database.transaction(stores, "readonly");
            const enabled = await requestValue(transaction.objectStore("config").get("enabled"));
            const progressRecord = await requestValue(transaction.objectStore("indexingProgress").get("content"));
            const metadataCount = stores.includes("metadata")
                ? await requestValue(transaction.objectStore("metadata").count())
                : 0;
            const contentCount = stores.includes("content")
                ? await requestValue(transaction.objectStore("content").count())
                : 0;
            database.close();

            const progress =
                progressRecord && typeof progressRecord === "object"
                    ? (progressRecord as { status?: unknown; totalItems?: unknown })
                    : null;
            const indexingStatus = typeof progress?.status === "number" ? progress.status : 0;
            const total = Math.max(metadataCount, typeof progress?.totalItems === "number" ? progress.totalItems : 0);
            const percentage = total > 0 ? Math.min(100, Math.round((contentCount / total) * 100)) : 0;
            if (indexingStatus === 3 && enabled === true) {
                statuses.push({
                    mode: "ready",
                    progress: 100,
                    indexedMessages: contentCount,
                    totalMessages: total || contentCount,
                    message: "E-mailinhoud is lokaal en versleuteld doorzoekbaar.",
                });
            } else if (indexingStatus === 1) {
                statuses.push({
                    mode: "indexing",
                    progress: percentage,
                    indexedMessages: contentCount,
                    totalMessages: total || null,
                    message: "Proton downloadt en versleutelt e-mailinhoud voor lokaal zoeken.",
                });
            } else if (indexingStatus === 2) {
                statuses.push({
                    mode: "paused",
                    progress: percentage,
                    indexedMessages: contentCount,
                    totalMessages: total || null,
                    message: "Het lokaal indexeren van e-mailinhoud is gepauzeerd.",
                });
            } else if (indexingStatus === 3) {
                statuses.push({
                    mode: "disabled",
                    progress: 100,
                    indexedMessages: contentCount,
                    totalMessages: total || contentCount,
                    message: "De lokale inhoudsindex bestaat, maar zoeken in inhoud staat uit.",
                });
            } else {
                statuses.push({
                    mode: "not-enabled",
                    progress: percentage || null,
                    indexedMessages: contentCount || null,
                    totalMessages: total || null,
                    message: "Zoeken in e-mailinhoud moet nog in Proton worden ingeschakeld.",
                });
            }
        } catch {
            // A database can disappear during an account switch. Try the next one.
        }
    }

    const priority = { ready: 5, indexing: 4, paused: 3, disabled: 2, "not-enabled": 1, unavailable: 0 };
    if (statuses.length) return statuses.sort((left, right) => priority[right.mode] - priority[left.mode])[0];
    return {
        mode: "not-enabled",
        progress: null,
        indexedMessages: null,
        totalMessages: null,
        message: "Zoeken in e-mailinhoud moet nog in Proton worden ingeschakeld.",
    };
};

const enableSearchInPage = async (): Promise<boolean> => {
    const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const existingForm = document.querySelector('form[name="advanced-search"]');
    if (!existingForm) {
        const searchInput = document.querySelector<HTMLElement>('[data-testid="search-keyword"]');
        if (!searchInput) return false;
        searchInput.click();
        await wait(350);
    }

    const toggle = document.querySelector<HTMLInputElement>("#es-toggle");
    if (toggle && !toggle.checked && !toggle.disabled) {
        toggle.click();
        await wait(250);
    } else {
        const activate = document.querySelector<HTMLElement>('[data-testid="encrypted-search:activate"]');
        if (activate) {
            activate.click();
            await wait(300);
            const confirm = document.querySelector<HTMLElement>('[data-testid="encrypted-search:enable"]');
            if (confirm) {
                confirm.click();
                await wait(350);
            }
        } else {
            const buttons = Array.from(
                document.querySelectorAll<HTMLButtonElement>('form[name="advanced-search"] button'),
            );
            const resume = buttons.find((button) =>
                /^(resume|hervatten|doorgaan)$/i.test(button.textContent?.trim() || ""),
            );
            if (resume && !resume.disabled) {
                resume.click();
                await wait(250);
            }
        }
    }

    if (!existingForm) {
        document.querySelector<HTMLElement>('[data-testid="overlay-button"] .overlay-backdrop')?.click();
    }
    return true;
};

const navigateToSearchInPage = (target: string): boolean => {
    const url = new URL(target);
    if (url.origin !== window.location.origin) return false;
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    return true;
};

const executePageFunction = async <T>(contents: WebContents, callback: () => unknown): Promise<T> =>
    (await contents.executeJavaScript(`(${callback.toString()})()`, true)) as T;

export const readMailContentSearchStatus = async (contents: WebContents): Promise<MailContentSearchStatus> => {
    if (contents.isDestroyed() || !mailOrderSearchURL(contents.getURL(), "123")) return unavailableStatus();
    try {
        return await executePageFunction<MailContentSearchStatus>(contents, readSearchStatusInPage);
    } catch {
        return unavailableStatus("De status van Proton zoeken kon niet worden gelezen.");
    }
};

export const enableMailContentSearch = async (contents: WebContents): Promise<MailSearchActionResult> => {
    if (contents.isDestroyed()) return { ok: false, message: "Proton Mail is niet beschikbaar." };
    try {
        const started = await executePageFunction<boolean>(contents, enableSearchInPage);
        const status = await readMailContentSearchStatus(contents);
        return started
            ? { ok: true, message: status.message, status }
            : { ok: false, message: "Open eerst uw Proton-inbox en probeer het opnieuw.", status };
    } catch {
        return { ok: false, message: "Zoeken in e-mailinhoud kon niet worden ingeschakeld." };
    }
};

export const openMailOrderSearch = async (contents: WebContents, value: unknown): Promise<MailSearchActionResult> => {
    const query = normalizeMailOrderQuery(value);
    if (!query) return { ok: false, message: "Vul een geldig ordernummer in." };
    const target = mailOrderSearchURL(contents.getURL(), query);
    if (!target || contents.isDestroyed()) return { ok: false, message: "Proton Mail is niet beschikbaar." };

    let status = await readMailContentSearchStatus(contents);
    if (["not-enabled", "disabled"].includes(status.mode)) {
        const activation = await enableMailContentSearch(contents);
        status = activation.status ?? status;
    }
    try {
        const script = `(${navigateToSearchInPage.toString()})(${JSON.stringify(target)})`;
        const navigated = (await contents.executeJavaScript(script, true)) as boolean;
        if (!navigated) return { ok: false, message: "De zoekopdracht kon niet in Proton worden geopend.", status };
        const partial = status.mode !== "ready";
        return {
            ok: true,
            message: partial
                ? `Zoeken naar ${query} is geopend. De inhoudsindex wordt nog opgebouwd; resultaten kunnen tijdelijk onvolledig zijn.`
                : `Alle e-mails met ordernummer ${query} zijn in Proton geopend.`,
            status,
        };
    } catch {
        return { ok: false, message: "De zoekopdracht kon niet in Proton worden geopend.", status };
    }
};
