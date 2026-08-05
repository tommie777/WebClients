import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import {
    type IPCInboxMessageBroker,
    type IPCInboxHostUpdateMessageType,
    type IPCInboxHostUpdateListener,
    IPCInboxHostUpdateMessageSchema,
} from "@proton/shared/lib/desktop/desktopTypes";
import Logger from "electron-log";
import { disableMouseNavigation } from "@proton/shared/lib/desktop/disableMouseNavigation";
import {
    ORDER_FILES_BROWSE_CHANNEL,
    ORDER_FILES_DRAG_CHANNEL,
    ORDER_FILES_OPEN_CHANNEL,
    ORDER_FILES_REVEAL_CHANNEL,
    type OrderFilesBrowseRequest,
} from "./copilot/orderFilesContract";

const preloadLogger = Logger.scope("preload");
const isColorspaceCopilotSidecar = new URLSearchParams(window.location.search).has("sidecar");

if (!isColorspaceCopilotSidecar) {
    contextBridge.exposeInMainWorld("ipcInboxMessageBroker", {
        hasFeature: (feature) => {
            return ipcRenderer.sendSync("hasFeature", feature);
        },

        getInfo: (type) => {
            return ipcRenderer.sendSync("getInfo", type);
        },

        getUserInfo: (type, userID) => {
            return ipcRenderer.sendSync("getUserInfo", type, userID);
        },

        getAsyncData: (type, ...args) => {
            return ipcRenderer.invoke("getAsyncData", type, ...args);
        },

        on: addHostUpdateListener,
        send: (type, payload) => {
            preloadLogger.info(`Sending message: ${type}`);
            ipcRenderer.send("clientUpdate", { type, payload });
        },
    } satisfies IPCInboxMessageBroker);

    contextBridge.exposeInMainWorld("crashBandicoot", {
        reportTestingError: () => {
            ipcRenderer.send("clientUpdate", {
                type: "reportTestingError",
                payload: undefined,
            });
        },
        triggerCrash: () => {
            ipcRenderer.send("clientUpdate", {
                type: "triggerCrash",
                payload: undefined,
            });
        },
    });
}

if (isColorspaceCopilotSidecar) {
    contextBridge.exposeInMainWorld("colorspaceCopilotLayout", {
        setSidecarWidth: (width: number) => {
            if (Number.isFinite(width)) {
                ipcRenderer.send("colorspace-copilot-sidecar-width", Math.round(width));
            }
        },
    });

    contextBridge.exposeInMainWorld("colorspaceOrderFiles", {
        browse: (request: OrderFilesBrowseRequest) => ipcRenderer.invoke(ORDER_FILES_BROWSE_CHANNEL, request),
        open: (id: string) => ipcRenderer.invoke(ORDER_FILES_OPEN_CHANNEL, id),
        reveal: (id: string) => ipcRenderer.invoke(ORDER_FILES_REVEAL_CHANNEL, id),
        startDrag: (ids: string[]) => ipcRenderer.send(ORDER_FILES_DRAG_CHANNEL, ids),
    });
}

function addHostUpdateListener(eventType: IPCInboxHostUpdateMessageType, callback: IPCInboxHostUpdateListener) {
    const handleHostUpdate = (_event: IpcRendererEvent, message: unknown) => {
        const parsed = IPCInboxHostUpdateMessageSchema.safeParse(message);

        if (!parsed.success) {
            preloadLogger.error("Invalid host update message format:", parsed.error);
            return;
        }

        if (parsed.data.type != eventType) {
            // Needs refactor: inda-refactor-001
            // for tracing do: preloadLogger.debug(`Skipping ${eventType} for event ${parsed.data.type} payload`);
            return;
        }

        callback(parsed.data.payload);
    };

    ipcRenderer.on("hostUpdate", handleHostUpdate);

    return {
        removeListener() {
            ipcRenderer.off("hostUpdate", handleHostUpdate);
        },
    };
}

disableMouseNavigation();
