import type { WebContents } from "electron";

export const MAIL_SIDEBAR_MINIMUM_WIDTH = 210;
export const MAIL_SIDEBAR_MAXIMUM_WIDTH = 440;
export const MAIL_SIDEBAR_DEFAULT_WIDTH = 250;

export const normalizeMailSidebarWidth = (width: number) => {
    if (!Number.isFinite(width)) return MAIL_SIDEBAR_DEFAULT_WIDTH;
    return Math.max(MAIL_SIDEBAR_MINIMUM_WIDTH, Math.min(MAIL_SIDEBAR_MAXIMUM_WIDTH, Math.round(width)));
};

const resizeScript = `(() => {
    const handleId = "colorspace-mail-sidebar-resizer";
    const styleId = "colorspace-mail-sidebar-resizer-style";
    const storageKey = "colorspace-mail-sidebar-width";
    const minimumWidth = ${MAIL_SIDEBAR_MINIMUM_WIDTH};
    const maximumWidth = ${MAIL_SIDEBAR_MAXIMUM_WIDTH};
    const normalize = (width) => Math.max(minimumWidth, Math.min(maximumWidth, Math.round(width)));
    const storedWidth = Number(localStorage.getItem(storageKey));
    const initialWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? normalize(storedWidth) : ${MAIL_SIDEBAR_DEFAULT_WIDTH};

    if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = \`
            :root { --colorspace-mail-sidebar-width: \${initialWidth}px; }
            .sidebar:not(.sidebar--collapsed) {
                position: relative !important;
                inline-size: var(--colorspace-mail-sidebar-width) !important;
                flex: 0 0 var(--colorspace-mail-sidebar-width) !important;
                transition: none !important;
            }
            .sidebar:not(.sidebar--collapsed) .logo-container { inline-size: 100% !important; }
            #\${handleId} {
                position: absolute;
                z-index: 1000;
                inset: 0 0 0 auto;
                inline-size: 9px;
                border: 0;
                background: transparent;
                cursor: col-resize;
                touch-action: none;
                -webkit-app-region: no-drag;
            }
            #\${handleId}::after {
                position: absolute;
                inset: 0 2px 0 auto;
                inline-size: 2px;
                content: "";
                background: color-mix(in srgb, var(--border-norm) 72%, transparent);
            }
            #\${handleId}:hover::after,
            #\${handleId}:focus-visible::after {
                inline-size: 4px;
                background: var(--interaction-norm);
            }
            #\${handleId}:focus-visible { outline: 2px solid var(--focus-outline); outline-offset: -3px; }
            .sidebar--collapsed #\${handleId} { display: none; }
        \`;
        document.head.append(style);
    }

    const setWidth = (width) => {
        const normalized = normalize(width);
        document.documentElement.style.setProperty("--colorspace-mail-sidebar-width", \`\${normalized}px\`);
        localStorage.setItem(storageKey, String(normalized));
        document.getElementById(handleId)?.setAttribute("aria-valuenow", String(normalized));
    };
    setWidth(initialWidth);

    const attach = () => {
        const sidebar = document.querySelector(".sidebar");
        if (!(sidebar instanceof HTMLElement) || sidebar.querySelector(\`#\${handleId}\`)) return;
        const handle = document.createElement("div");
        handle.id = handleId;
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-label", "Breedte van mappenlijst aanpassen");
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-valuemin", String(minimumWidth));
        handle.setAttribute("aria-valuemax", String(maximumWidth));
        handle.setAttribute("aria-valuenow", String(initialWidth));
        handle.title = "Sleep om de mappenlijst breder of smaller te maken";
        handle.addEventListener("pointerdown", (event) => {
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
            if (handle.hasPointerCapture(event.pointerId)) setWidth(event.clientX);
        });
        handle.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--colorspace-mail-sidebar-width"));
            setWidth(current + (event.key === "ArrowRight" ? 20 : -20));
        });
        sidebar.append(handle);
    };

    attach();
    if (!window.__colorspaceMailSidebarResizeObserver) {
        window.__colorspaceMailSidebarResizeObserver = new MutationObserver(attach);
        window.__colorspaceMailSidebarResizeObserver.observe(document.body, { childList: true, subtree: true });
    }
})()`;

export const installMailSidebarResize = async (contents: WebContents) => {
    await contents.executeJavaScript(resizeScript);
};
