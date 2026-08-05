import { type } from "os";

export const isBetaRelease = process.env.RELEASE === "beta";

export const getIco = () => {
    if (isBetaRelease) {
        return "icon-beta.ico";
    }
    return "icon.ico";
};

export const getIcon = () => {
    return "colorspace-copilot";
};

export const getName = () => {
    return "Colorspace Proton Copilot";
};

export const getExtraResource = () => {
    const commonResources = [
        "./assets/proton-spinner.svg",
        "./assets/loading.html",
        "./assets/error-network.html",
        "./assets/blank.html",
        "./assets/icons/icon.png",
        "../../packages/styles/assets/img/errors/error-network.svg",
    ];

    switch (type()) {
        case "Darwin":
            return [
                ...commonResources,
                "./src/macos/Proton Mail Uninstaller.app",
                "./src/macos/uninstall.sh",
            ];
        case "Windows_NT":
            return [
                ...commonResources,
                "./src/windows/uninstall.bat",
                "./src/utils/protocol/protonmail-mailto-register.reg",
                "./src/utils/protocol/protonmail-mailto-delete.reg",
                "./assets/icons/icon.ico",
            ];
        default:
            return commonResources;
    }
};

const transportSecuirityException = {
    NSExceptionAllowsInsecureHTTPLoads: false,
    NSIncludesSubdomains: true,
    NSThirdPartyExceptionRequiresForwardSecrecy: false,
    NSThirdPartyExceptionAllowsInsecureHTTPLoads: false,
};

export const getAppTransportSecuity = () => {
    return {
        NSAppTransportSecurity: {
            NSAllowsArbitraryLoads: true,
            NSExceptionDomains: {
                "update.electronjs.org": { ...transportSecuirityException },
                "proton.me": { ...transportSecuirityException },
                "mail.proton.me": { ...transportSecuirityException },
                "account.proton.me": { ...transportSecuirityException },
                "calendar.proton.me": { ...transportSecuirityException },
            },
        },
    };
};
