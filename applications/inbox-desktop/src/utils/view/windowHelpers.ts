import { BrowserWindowConstructorOptions } from "electron";
import { MINIMUM_HEIGHT, MINIMUM_WIDTH, getWindowBounds } from "../../store/boundsStore";
import { getSettings } from "../../store/settingsStore";
import { isLinux, isMac, isWindows } from "../helpers";
import { appSession } from "../session";
import { MAIL_APP_NAME } from "@proton/shared/lib/constants";
import { isProdEnv } from "../isProdEnv";
import { getIconResourcePath } from "../../constants/resources";
import { COPILOT_WINDOW_MINIMUM_WIDTH } from "../../copilot/sidecarLayout";
import pkg from "../../../package.json";

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const getOSSpecificConfig = (): BrowserWindowConstructorOptions => {
    if (isMac) {
        return {
            titleBarStyle: "hiddenInset",
            trafficLightPosition: { x: 12, y: 18 },
            backgroundColor: "#19171f",
        };
    } else if (isWindows) {
        return {};
    } else if (isLinux) {
        return {};
    }
    return {};
};

export const getWindowConfig = (): BrowserWindowConstructorOptions => {
    const { x, y, width, height } = getWindowBounds();
    const settings = getSettings();

    return {
        title: isProdEnv() ? MAIL_APP_NAME : `${MAIL_APP_NAME} Dev`,
        icon: getIconResourcePath(isWindows ? "icon.ico" : "icon.png"),
        x,
        y,
        width,
        height,
        minWidth: pkg.config.colorspaceCopilot ? COPILOT_WINDOW_MINIMUM_WIDTH : MINIMUM_WIDTH,
        minHeight: MINIMUM_HEIGHT,
        autoHideMenuBar: true,
        show: false,
        ...getOSSpecificConfig(),
        webPreferences: {
            devTools: true,
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            spellcheck: settings.spellChecker,
            // Security additions
            session: appSession(),
            nodeIntegration: false,
            contextIsolation: true,
            disableBlinkFeatures: "Auxclick",
            sandbox: true,
            ...(getOSSpecificConfig().webPreferences || {}),
        },
    };
};

export const getWindowPlaywrightConfig = (): BrowserWindowConstructorOptions => {
    const config = getWindowConfig();

    return {
        ...config,
        show: true,
        paintWhenInitiallyHidden: false,
        webPreferences: {
            ...config.webPreferences,
            backgroundThrottling: false,
            sandbox: false,
        },
    };
};
