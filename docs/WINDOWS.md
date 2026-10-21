# Windows status

**No Windows installer is published.** Do not advertise the Mac ZIP as Windows compatible or rename it to an EXE. The AI core being portable does not make the desktop app a tested Windows product.

| Component | What the source currently supports | Windows work still needed |
| --- | --- | --- |
| Translucent reading UI, context and preferences | Web technologies; portable logic has a Windows CI job | Native window rendering, focus, scaling, multi-monitor and accessibility tests |
| Local Qwen3 | WebLLM/WebGPU; checks for shader-f16 | Real inference on supported NVIDIA, AMD and Intel GPUs, current drivers and low-memory devices |
| Local Whisper | WebAssembly worker | Real microphone, system audio, Bluetooth and simultaneous-source tests |
| OpenAI and Claude API connections | Electron/Node; encrypted storage abstraction | Real provider requests and Windows DPAPI persistence, removal and failure tests |
| Computer audio | Electron loopback capture path | Windows audio capture, disconnect, resume and device-change validation |
| ChatGPT connection | Shared native bridge | Browser sign-in, callback, reconnect and sign-out on Windows |
| Share View | A compiled Swift/AppKit/ScreenCaptureKit helper | A separate Windows implementation and receiving-device tests |
| Hold right Option to open | A compiled macOS launcher and LaunchAgent | Windows shortcut design, installer and background-launch behavior |
| Distribution | macOS packager, plist, ad-hoc signing and ZIP | Windows packaging, code signing, installation, update/uninstall and SmartScreen testing |

The Windows CI job installs dependencies, builds the portable assets and runs selected model/runtime/renderer tests. It is **not** a Windows desktop or GPU test. No capture invisibility or detection claim follows from those checks.

A Windows preview should not be released until it starts on a clean Windows machine, stores credentials securely, generates local and cloud answers, captures the intended audio, handles lost devices without continued recording, and installs/uninstalls cleanly. Capture behavior must be described by tested sharing mode and OS version.

Reference: [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer). Electron supports loopback capture paths, but application-specific validation is still necessary.
