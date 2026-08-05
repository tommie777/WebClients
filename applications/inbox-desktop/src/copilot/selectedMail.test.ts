import { selectedMailFromURL } from "./selectedMail";

describe("selectedMailFromURL", () => {
    it("extracts a selected conversation from the production mail route", () => {
        expect(selectedMailFromURL("https://mail.proton.me/u/0/inbox/conversation-123")).toEqual({
            labelID: "inbox",
            elementID: "conversation-123",
        });
    });

    it("extracts an explicitly selected message", () => {
        expect(selectedMailFromURL("https://mail.proton.me/archive/conversation-123/message-456")).toEqual({
            labelID: "archive",
            elementID: "conversation-123",
            messageID: "message-456",
        });
    });

    it("ignores mailbox lists, settings, foreign hosts, and malformed IDs", () => {
        expect(selectedMailFromURL("https://mail.proton.me/u/0/inbox")).toBeNull();
        expect(selectedMailFromURL("https://mail.proton.me/u/0/settings/security")).toBeNull();
        expect(selectedMailFromURL("https://example.com/inbox/conversation-123")).toBeNull();
        expect(selectedMailFromURL("https://mail.proton.me/inbox/%2Fetc%2Fpasswd")).toBeNull();
    });
});
