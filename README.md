# Web clients

## Colorspace Proton Copilot

Deze fork bevat een apart geïsoleerde desktopvariant voor de Colorspace Mail
Copilot. De macOS-app gebruikt:

- appnaam **Colorspace Proton Copilot**;
- bundle-ID `nl.colorspace.proton-copilot`;
- profielmap `~/Library/Application Support/Colorspace Proton Copilot`;
- een eigen blauw Copilot-icoon.

De profielmap en single-instance lock zijn gescheiden van de officiële Proton
Mail-app. Beide apps kunnen daardoor tegelijk draaien. De eerste keer moet in
de Colorspace-app apart bij Proton worden ingelogd; accounts, cookies en cache
van de officiële app worden niet gekopieerd.

Om conflicten te vermijden registreert deze interne variant geen `mailto:`-
handler, vraagt hij niet om standaard mail-app te worden en gebruikt hij niet
Protons automatische updater of Sentry-configuratie. Mailverkeer en encryptie
blijven via de bestaande Proton-webclient lopen; de Colorspace-aanpassing leest
alleen de actief geopende conversatie voor de lokale Copilot-bridge.

Start de geïnstalleerde Colorspace-app bij voorkeur via het hoofdproject:

```bash
cd /Users/imackaartendrukkerij/Documents/ColorspaceMailCopilot
npm run proton
```

De achtergrondservice op poort 3210 moet daarbij actief zijn; controleer die
met `npm run service:status` in hetzelfde hoofdproject. De geïnstalleerde
appbundel wordt vernieuwd met `nvm use 24` gevolgd door
`npm run proton:install`. Gebruik `npm run proton:dev` alleen voor ontwikkeling;
macOS toont uitsluitend die ontwikkelvariant onder de generieke naam Electron.

This project is a monorepo hosting the Proton web clients. It includes the web applications, their dependencies & shared modules as well as all tooling surrounding development of the web clients (as well as some additional miscellaneous things).

- <img src="./applications/mail/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Mail</span>
- <img src="./applications/calendar/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Calendar</span>
- <img src="./applications/drive/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Drive</span>
- <img src="./applications/account/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Account</span>
- <img src="./applications/vpn-settings/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton VPN</span>
- <img src="./applications/pass/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Pass</span>
- <img src="./applications/wallet/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Wallet</span>
- <img src="./applications/lumo/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Lumo</span>
- <img src="./applications/meet/src/favicon.svg" style="vertical-align: middle" height="20" width="20" /> <span style="vertical-align: middle; display: inline-block">Proton Meet</span>

Technically, this monorepo is based on Yarn & Yarn Workspaces, with unified versioning for all packages inside.

## Getting Started

### Prerequisites

You'll need to have the following environment to work with this project:

- Node.js LTS
- Yarn 4
- git

See `package.json` for specific version requirements.

### Installation

```shell
# Clone the project
git clone https://github.com/ProtonMail/WebClients.git
git clone git@github.com:ProtonMail/WebClients.git

# Install all dependencies for the entire monorepo & symlink
# local dependents to one another
yarn install

# Run web clients by running proton-<package-name>
# Example: proton mail web client
yarn workspace proton-mail start
```

For additional details on how to interact with the monorepo, see the [yarn docs](https://yarnpkg.com/) for reference.

## How VPN app differs from the rest

VPN is present in both proton.me and protonvpn.com. However, they are served differently. Some parts of VPN are shared, hosted within `@proton/components` or `@proton/shared`, however, the entry points to them are different.

For protonvpn.com, the entry point comes from `applications/vpn-settings` and for account.proton.me/u/{X}/vpn, the entry point is `applications/account`.

Since both domains are separate, we don't share a local SSO between them. Therefore, we need to serve both applications separately:

```shell
# To serve VPN through vpn-settings
yarn workspace --port 8050 proton-vpn-settings start

# To serve VPN through account
yarn start-all --applications "proton-account"
```

## How to version an application manually

While being on the `main` branch for a clean release.

From the root folder, run `yarn workspace @proton/version run version --applications proton-X --version x.x.x.x`

## Help us to translate the project

You can learn more about it on [our blog post](https://proton.me/blog/translation-community).

## License

The code and data files in this distribution are licensed under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See https://www.gnu.org/licenses/ for a copy of this license.

See [LICENSE](LICENSE) file
