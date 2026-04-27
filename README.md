[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
# LOCKED
All information regarding my LOCKED password manager

# 🔒 LOCKED — Password Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.0.0-green)
![Platform](https://img.shields.io/badge/browser-Firefox%20%7C%20Chrome-orange)

A secure, local-only browser extension for managing passwords and private notes. No cloud, no accounts, no nonsense — everything stays on your device.

---

## What it does

- **Vault** — store and manage login credentials, all encrypted
- **Secret Notes** — save sensitive info that doesn't fit in a password field
- **Password Generator** — generate strong random passwords with custom options
- **Breach Checker** — check if a password has been leaked using the HaveIBeenPwned API
- **Strength Checker** — real-time password strength feedback
- **Master Password** — everything locked behind one password, derived with PBKDF2 at 600,000 iterations

All data is encrypted with AES-GCM before it ever touches storage. The master password is never stored anywhere.

---

## Installation

### Firefox (Temporary)
1. Open Firefox and go to `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file from this project

### Chrome
1. Go to `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the project folder

---

## How it works

When you set a master password, a random salt is generated and PBKDF2 derives an AES-GCM key from it. That key lives in memory only for the duration of your session. After 5 minutes of inactivity the session locks itself and the key is wiped. Nothing sensitive is ever written to disk in plaintext.

The breach checker uses k-anonymity — only the first 5 characters of a SHA-1 hash are sent to the API, so your actual password never leaves the browser.

---

## Project structure

```
locked-password-manager/
├── manifest.json       # extension config
├── popup.html          # UI
├── popup.js            # all application logic
├── logo.png            # extension icon
└── README.md
```

---

## Built with

- Vanilla JavaScript (ES6)
- Web Crypto API
- Chrome Extension API (compatible with Firefox via `browser` polyfill)
- [HaveIBeenPwned API](https://haveibeenpwned.com/API/v3)

---

## Licence

MIT — do whatever you want with it, just keep the credit. See [LICENSE](LICENSE) for the full text.
