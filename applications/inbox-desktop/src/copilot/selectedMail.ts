export type SelectedMail = {
    labelID: string;
    elementID: string;
    messageID?: string;
};

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
    const configured = process.env.COLORSPACE_COPILOT_SELECTION_URL?.trim();
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

let lastSelection = "";

export const notifyCopilotOfSelectedMail = async (rawURL: string): Promise<void> => {
    const endpoint = loopbackEndpoint();
    const selection = selectedMailFromURL(rawURL);
    if (!endpoint || !selection) {
        return;
    }

    const key = JSON.stringify(selection);
    if (key === lastSelection) {
        return;
    }

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
        if (response.ok) {
            lastSelection = key;
        }
    } catch {
        // The local copilot helper is optional and must never interrupt mail.
    }
};
