# Colorspace Copilot selection experiment

This experiment answers one question only: can the Proton desktop shell observe
which mailbox element the employee opened without reading or exporting decrypted
email content?

Yes. Proton Mail routes an opened element as
`/:labelID/:elementID/:messageID?`. The Electron shell already observes both full
and in-page navigation. The proof of concept parses that route and can notify an
optional helper bound to the local loopback interface.

Nothing is sent unless `COLORSPACE_COPILOT_SELECTION_URL` is configured. The
endpoint must use plain HTTP on `localhost`, `127.0.0.1`, or `::1`; remote hosts,
embedded credentials, malformed routes, and duplicate selections are rejected.
The payload contains only Proton's opaque label, element, and optional message
identifiers. It does not contain sender, subject, body, attachments, credentials,
tokens, encryption keys, or decrypted email.

## Local smoke test

Start the receiver:

```sh
node research/colorspace-copilot/selection-receiver.mjs
```

Build or start the desktop application with:

```sh
COLORSPACE_COPILOT_SELECTION_URL=http://127.0.0.1:3210/selection \
  yarn workspace proton-inbox-desktop start
```

Opening a conversation should print an opaque selection such as:

```json
{ "labelID": "inbox", "elementID": "..." }
```

## What this does not prove

An opaque Proton element ID is not enough to generate a useful answer. A later,
separately reviewed experiment would need an explicit employee action that passes
the selected, already-decrypted conversation to the local copilot boundary. That
step must address Proton approval, plaintext minimization, user consent, OpenAI
processing, composer insertion, and the security/update ownership of a modified
client. This proof of concept deliberately does none of those things.
