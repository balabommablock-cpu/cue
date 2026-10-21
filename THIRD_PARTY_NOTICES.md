# Third-party software

Cue's original application code is MIT-licensed. Dependencies retain the licenses in their packages. `package-lock.json` pins the dependency tree; packaged builds collect the installed dependency LICENSE/NOTICE files into `THIRD_PARTY_NOTICES.txt`.

- Electron and its bundled Chromium/Node components retain their included licenses.
- WebLLM, Transformers.js, ONNX Runtime, pdfjs, fflate, jose, Vite and the packaging/build tools retain their upstream licenses.
- Qwen3 and Whisper model files are downloaded separately and governed by the license and terms at each model's source. Check those sources before redistributing weights.
- The ChatGPT protocol implementation in this repository is independently written. No external noncommercial account SDK source is included.
- The app icon and synthetic sample audio are included as Cue project assets.

No dependency's license is replaced by this repository's MIT license. Account-provider terms and plan eligibility are separate from the application code license.
