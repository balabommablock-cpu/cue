# Development

The main components are an Electron main process (`desktop.cjs`), a local HTTP service (`server.mjs`), browser UI in `public/`, local model workers in `device-src/`, and macOS sharing/shortcut helpers in `native/`.

The main process owns OAuth tokens and native permissions. It validates the sender before handling IPC. The renderer handles the conversation and reading UI; it receives no account token. Local workers use bounded context retrieval. Model files and user context are not committed.

## Customization

Use Display for the built-in reading presets and portable preference files. The preferences schema deliberately excludes context, account and device identifiers. Core validation lives in `public/preferences-ui.js`.

UI styles are in `public/styles.css`. General answer instructions are in `device-src/context.mjs`; legacy Codex/Realtime prompts are in `prompt.mjs` and `answer-context.mjs`. Keep factual evidence separate from style instructions. Do not teach the model that generated drafts establish personal facts.

Local model choices are defined in `device-src/models.js`. Adding a model requires checking memory use, license, context window and an actual accuracy/latency evaluation on the target Mac. Do not replace the default with a model that only passes a synthetic happy-path test.

## Launcher

Build optional native helpers with `npm run build:native` and `npm run build:launcher`. `node install-launcher.mjs` installs the right-Option hold launcher for the current user. Read the script before installation; it creates a per-user LaunchAgent. A normal app launch does not install a background launcher silently.

## Packaging

`npm run package` uses a runtime allowlist and starts from blank defaults. It does not copy this repository wholesale. It builds the native helpers and ad-hoc signs the app, then verifies that signature. Developer ID signing and notarization are separate release work requiring a maintainer's own Apple credentials; never commit those credentials.

Do not run a development server on port 4329 while an installed Cue app is using it. `PORT=4358 npm start` is convenient for UI work without replacing an installed application or its data.

## Tests

`npm test` runs provider boundary, cancellation, audio segmentation, context isolation, renderer fault-injection, native-controller and preference-validation tests. Some tests inspect the built local assets, so run `npm run build` first. They do not replace physical microphone, real cloud-account or receiving-device capture tests.

`npm run audit:public` rejects common secret formats, machine-specific paths and private artifact types in the source tree. Run a dedicated secret scanner before publishing, and inspect the staged file list. Use a fresh, synthetic QA profile when testing sign-in or recording.
