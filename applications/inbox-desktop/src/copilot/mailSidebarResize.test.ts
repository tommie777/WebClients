import {
    MAIL_SIDEBAR_DEFAULT_WIDTH,
    MAIL_SIDEBAR_MAXIMUM_WIDTH,
    MAIL_SIDEBAR_MINIMUM_WIDTH,
    normalizeMailSidebarWidth,
} from "./mailSidebarResize";

describe("normalizeMailSidebarWidth", () => {
    it("keeps the Proton folder hierarchy within accessible limits", () => {
        expect(normalizeMailSidebarWidth(100)).toBe(MAIL_SIDEBAR_MINIMUM_WIDTH);
        expect(normalizeMailSidebarWidth(320.4)).toBe(320);
        expect(normalizeMailSidebarWidth(800)).toBe(MAIL_SIDEBAR_MAXIMUM_WIDTH);
        expect(normalizeMailSidebarWidth(Number.NaN)).toBe(MAIL_SIDEBAR_DEFAULT_WIDTH);
    });
});
