# Your first conversation with Cue

You do not need Terminal, GitHub, Python or a separate local-AI app to use the Mac download.

## 1. Install Cue

Use the [Cue download page](https://cue-personal.netlify.app/) on an M-series Mac running macOS 14.2 or later. Download the **DMG**, open it, and drag **Cue** onto **Applications**. Open Cue from Applications, then eject the Cue disk image in Finder.

This is a **preview**, not an Apple-notarized public release. macOS can block it on a new Mac. Keep the Mac's security protections enabled; read [Apple's explanation of app-opening warnings](https://support.apple.com/en-us/102445) before deciding whether to open an unverified app. On a work-managed Mac, ask your administrator. A signed, notarized release is still needed for a smooth general rollout.

Already have Cue? Quit it first, replace it in Applications, then open that copy. Your saved context, accounts and downloaded models stay on your Mac. An update may require macOS recording access to be approved again.

## 2. Add your context

First-use setup opens automatically. Import your CV or paste a few notes under **Your context**, check the text, and save. You can skip this and try a general question first. Fresh downloads contain no previous user's account or notes.

Keep notes factual. Include the role you are preparing for, the work you personally did and the results you can support. A little clear context is more useful than an unreviewed pile of documents.

## 3. Choose your AI

| If you want… | Choose… | What you need |
| --- | --- | --- |
| To use your ChatGPT plan | **ChatGPT** | Your own eligible account and an internet connection |
| No account and local inference | **On this Mac** | Internet for the first model download, enough memory and storage |
| An OpenAI API model | **OpenAI API** | Your own API key, model access and API credit |
| A Claude API model | **Claude API** | Your own Anthropic Console API key and API credit |

For local AI, use the size Cue recommends, then choose **Download & use local AI**. Downloads can take several minutes or longer depending on your connection. Wait for **Local AI is ready on this Mac**. If setup fails, try the smallest model. An M4 with 16 GB memory should start with Balanced; 8 GB Macs should start with Smallest, with other heavy apps closed. These are recommendations, not performance guarantees. [Download sizes and limitations](LOCAL_AI.md).

API keys are separate from ordinary ChatGPT or Claude subscriptions. Never paste a key into a GitHub issue, support screenshot or public chat. Cue's API connection keeps your saved key encrypted on your Mac. ChatGPT sign-in uses your own plan's eligibility and limits.

In **Try it**, choose **Try a typed question** or **Try a sample voice**. The sample uses an included recording and keeps your microphone off. Getting an answer here confirms the AI path; it does not yet check live audio.

## 4. Choose where the conversation happens

| Your situation | Cue source | What to check |
| --- | --- | --- |
| Video call playing on this Mac; you answer into a mic | **On this Mac** | Computer and microphone meters |
| Mac audio plus a phone or person nearby | **Mac + phone / room** | Computer and Room / phone meters |
| Phone on speaker or an in-person conversation | **Phone or in-person** | Room microphone meter |
| Only listen to audio playing on this Mac | **Mac audio only** | Computer audio meter |
| No recording | **Typed questions** | Type a question |

Choose **Start listening**. Approve the relevant macOS prompts directly on the Mac. Cue uses **Microphone** access for nearby speech and **Screen & System Audio Recording** for Mac playback. The screen-recording permission is used to obtain computer audio; screen images are not sent to the answering AI. [Apple's recording-permission guide](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac).

Before your conversation, play a short spoken clip on the Mac and say a question into the microphone. Check the corresponding meters move and an answer appears. Choose **Stop** and confirm both meters say **Off**. For a nearby phone, use speakerphone and take turns speaking; overlapping room voices cannot be reliably separated. Headphones prevent Mac playback reaching the room microphone, but a nearby phone must still be audible to the mic.

## If something gets stuck

| What you see | What to do |
| --- | --- |
| **Starting** stays on screen | Check for a macOS recording or microphone prompt. Cancel in Cue if needed, approve access, quit Cue and reopen from Applications. Then start again. |
| Recording permission is blocked | Open **System Settings → Privacy & Security**. Enable Cue under **Microphone** and **Screen & System Audio Recording** as needed, then choose **Quit & Reopen**. |
| Old Cue entries are enabled but the new app is denied | Quit Cue. In the relevant recording-permission list, remove obsolete Cue entries and use **+** to add the exact **Cue.app in Applications**. Approve and reopen. Leave other applications' permissions alone. |
| Microphone meter stays still | In **Audio settings → Microphone & echo**, choose the connected microphone. Check **System Settings → Sound → Input** too. A phone on speaker must be close enough to hear. |
| Computer meter stays still | Confirm the clip or call is actually playing on this Mac, choose a source that includes Mac audio, and check recording permission. |
| Meters move but no useful answer appears | Try a short question, speak one at a time, or use **Type a question**. Whisper currently requests English and may mishear mixed languages or noise. |
| Local setup fails or answers are slow | Close heavy apps, try Smallest, or choose a cloud AI. Initial loading is slower than later answers; there is no fixed response-time guarantee. |
| A cloud AI refuses a request | Check your account limits, network connection, model access and API credit. A successful local sample does not check cloud billing. |

Use **Display** to change text size, opacity and scrolling. Use **Your AI** to switch connection or model. You can prepare separate interview context inside the app.

For help, [open an issue](https://github.com/balabommablock-cpu/cue/issues) with the Cue version shown in Settings, your Mac model, macOS version, AI choice, selected audio source and the error text. Do not include API keys, account codes, private CVs or recordings. [Security reports](../SECURITY.md) have a separate reporting path.

Use assistance where it is permitted. Share View requires a separate receiving-participant check and does not promise universal invisibility; see [sharing boundaries](SCREEN_SHARING.md).
