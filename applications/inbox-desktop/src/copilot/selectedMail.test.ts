import { normalizeExtractedMail, selectedMailFromURL } from "./selectedMail";

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

describe("normalizeExtractedMail", () => {
    const selection = { labelID: "inbox", elementID: "conversation-123" };

    it("keeps bounded decrypted message text and mail direction", () => {
        expect(
            normalizeExtractedMail(
                {
                    subject: "  Vraag over order  ",
                    senderEmail: "KLANT@EXAMPLE.NL",
                    recipientDomain: "COLORSPACE.NL",
                    messages: [
                        {
                            id: "message-1",
                            direction: "inbound",
                            sentAt: "vandaag",
                            bodyText: "  Waar blijft mijn bestelling?  ",
                        },
                        {
                            id: "message-2",
                            direction: "outbound",
                            bodyText: "Wij zoeken dit uit.",
                        },
                    ],
                },
                selection,
            ),
        ).toEqual({
            selection,
            subject: "Vraag over order",
            senderEmail: "klant@example.nl",
            recipientDomain: "colorspace.nl",
            messages: [
                {
                    id: "message-1",
                    direction: "inbound",
                    sentAt: "vandaag",
                    bodyText: "Waar blijft mijn bestelling?",
                },
                {
                    id: "message-2",
                    direction: "outbound",
                    bodyText: "Wij zoeken dit uit.",
                },
            ],
            relatedConversations: [],
        });
    });

    it("rejects empty and outbound-only selections", () => {
        expect(normalizeExtractedMail({ messages: [] }, selection)).toBeNull();
        expect(
            normalizeExtractedMail(
                { messages: [{ direction: "outbound", bodyText: "Interne uitgaande tekst" }] },
                selection,
            ),
        ).toBeNull();
    });

    it("waits until every message in the conversation is expanded", () => {
        expect(
            normalizeExtractedMail(
                {
                    complete: false,
                    messages: [{ direction: "inbound", bodyText: "Slechts één al geopend bericht." }],
                },
                selection,
            ),
        ).toBeNull();
    });

    it("keeps related conversation metadata for the Copilot sidecar", () => {
        const result = normalizeExtractedMail(
            {
                subject: "Vraag over order",
                senderEmail: "klant@example.nl",
                messages: [{ direction: "inbound", bodyText: "Zie mijn andere mail." }],
                relatedConversations: [
                    {
                        elementID: "conversation-related",
                        subject: "Bestanden",
                        participants: "klant@example.nl",
                        sentAt: "vandaag",
                    },
                    {
                        elementID: selection.elementID,
                        subject: "Huidige mail",
                        participants: "klant@example.nl",
                        sentAt: "vandaag",
                    },
                ],
            },
            selection,
        );

        expect(result?.relatedConversations).toEqual([
            {
                elementID: "conversation-related",
                subject: "Bestanden",
                participants: "klant@example.nl",
                sentAt: "vandaag",
            },
        ]);
    });
});
