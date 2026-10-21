# Cue

A small, translucent desktop assistant that helps you stay in a conversation. Bring your own context, choose local AI or your own ChatGPT account, and get concise cues you can read at a glance.

This Community edition starts with **no biography, saved account or previous user's notes**. Use assistance where the participants or assessment rules permit it.

![Cue displaying a prewritten example, with recording off](docs/images/cue-preview.png)

## Get started

Mac with Apple silicon, macOS 14.2 or newer. 16 GB memory is recommended; larger local models need more memory.

1. Get the Mac preview from [Releases](https://github.com/balabommablock-cpu/cue/releases). Move Cue.app to Applications.
2. Open **Your context** to add your CV or notes. Review what was imported before saving.
3. Open **Your AI**. Connect your own eligible ChatGPT account, or choose **On this Mac** and download a local model once.
4. Try a typed question first. Then choose computer audio, microphone, or both and press **Start listening**. macOS asks for the relevant permissions.

The preview is ad-hoc signed, **not Apple notarized**. A new Mac may block opening it. Developer ID signing and notarization remain a release requirement for a smooth installation; this repository does not supply a signing identity.

## Make it yours

- **Display**: text size, background opacity, automatic or manual scrolling, scroll pace and always-on-top.
- **Reading presets**: Compact, Comfortable and Large text. Export a preference file and import it on another Mac. Preference files exclude context, accounts, API keys and microphone device identifiers.
- **Settings → Show me**: an opening thought with short cues, or a conversational script.
- **Your context**: edit or export your notes. Confirm stories before using them as personal evidence.
- **Your AI**: change accounts, local model size or answer model. Advanced settings retain Codex and OpenAI Realtime connections.

Community stores its data separately in `~/Library/Application Support/Cue Community`. It does not adopt another Cue edition's saved account or knowledge workspace. Global launcher setup is optional: see [development](docs/DEVELOPMENT.md).

## AI choices

| Mode | What runs locally | What leaves the Mac |
| --- | --- | --- |
| On this Mac | Qwen3 answers and Whisper speech recognition | Model files are downloaded during setup; inference does not call a cloud model |
| ChatGPT | Speech recognition and context selection | Transcribed questions and relevant notes go to OpenAI through your own authorized account |
| Codex, advanced | Speech recognition and context selection | Selected text and reference facts go through your own installed Codex connection |
| OpenAI Realtime, advanced | Audio capture | Selected audio is sent to OpenAI using an API key you provide |

Local models are less capable than leading cloud models. Calculations and personal questions can take longer. There is no sub-second guarantee. ChatGPT plan access is subject to eligibility and the account's current limits; it does not read ChatGPT chat history. AI coaching and practice feedback currently require Codex.

## Screen sharing

**Cue cannot promise universal invisibility or undetectability.** The overlay is a normal desktop process. OS versions, sharing modes, recordings and meeting software can capture it.

The optional **Share View** creates a presentation window whose source stream excludes Cue. Select **Cue Share View — share this window** in the meeting's window picker. Independently sharing the whole display can expose Cue. Check the receiving participant's picture before relying on a setup.

[Capture boundaries and a reproducible test](docs/SCREEN_SHARING.md) explain what this feature does and what remains unverified. This project does not defeat proctoring, OS security, process inspection or browser restrictions.

## Build from source

Requires Node.js 22.12+ and npm. Native packaging requires macOS and Xcode Command Line Tools.

```sh
git clone https://github.com/balabommablock-cpu/cue.git
cd cue
npm ci
npm run build
npm test
npm run dev
```

Close other Cue copies using port 4329 before starting the desktop app. For a browser-only UI preview, `PORT=4358 npm start` serves the interface locally; native account sign-in and Share View need the desktop app.

```sh
npm run audit:public
npm run package
```

The package is created under `dist/share/`. It contains an empty profile, bundled runtime assets, native helpers and third-party notices. Model weights download separately. [Architecture and contribution guide](docs/DEVELOPMENT.md).

[Release validation and remaining limits](docs/VALIDATION.md).

## Security and ownership

Account tokens are encrypted through Electron safeStorage and stay in the native main process. The renderer receives status and answer text. API keys entered in Realtime settings are session-only. The local server binds to loopback, rejects foreign request origins and serves an explicit asset allowlist.

The repository has a fresh history, a Gitleaks scan and a separate public-source audit. Runtime data, environment files, credentials, signing keys, local workspaces, private research and deployment-owner secrets are excluded. See [SECURITY.md](SECURITY.md) before reporting a vulnerability.

MIT-licensed application code. Dependencies and model weights retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
