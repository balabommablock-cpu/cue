# Local AI in Cue

In the Mac app, open **Your AI → On this Mac → Download & use local AI**. One button downloads the selected answer model and Whisper speech recognition, then checks a real answer. No account, API key, Python, Ollama or Terminal setup is required. The public GitHub release and a source build use the same flow.

## Available models

| Choice | Exact model | Approximate download | Graphics-memory estimate from WebLLM | Conservative Mac recommendation |
| --- | --- | --- | --- | --- |
| Smallest | Qwen3-1.7B-q4f16_1-MLC | 1.1 GB | 2.0 GB | 8 GB total memory; simpler tasks |
| Balanced | Qwen3-4B-q4f16_1-MLC | 2.5 GB | 3.4 GB | 16 GB total memory |
| Stronger | Qwen3-8B-q4f16_1-MLC | 5 GB | 5.7 GB | 24 GB or more total memory |

Whisper Base (`onnx-community/whisper-base`, quantized) adds about 150 MB. Speech recognition currently requests English. Sizes are estimates; model assets and caches can require extra space. Keep several additional GB free. These memory recommendations leave room for macOS, the app, speech recognition and other open apps; they are not hardware benchmarks or guarantees. Apple silicon uses shared memory, so model memory also reduces the RAM available to other apps.

Cue recommends Smallest below 16 GB RAM, Balanced from 16 GB, and Stronger from 24 GB. The user can change that choice. Passing a memory recommendation is not proof that a model will run: Cue also checks WebGPU and shader-f16 support, and setup must generate an answer successfully.

## What local does and does not mean

- Initial setup requires internet to fetch model weights, tokenizers and the GPU runtime. Files are cached in Cue’s app data. Subsequent inference uses that cache; clearing app data or removing the cache requires another download.
- Selecting local mode keeps model inference, questions, selected personal context and speech processing on the device. Switching to ChatGPT or an API provider sends the selected request to that provider.
- Local models have no per-answer API charge. They still consume storage, memory, processing power, electricity and battery.
- Smaller models are substantially less capable than leading cloud models, particularly on difficult reasoning, arithmetic, subtle follow-ups and long or ambiguous questions. Any model can invent details; verify facts and calculations.
- Cue bounds the model’s active context to 4,096 tokens and retrieves excerpts from personal notes. A large document is not read in full for every question. Generation is capped; local mode is intended for concise help, not long documents.
- There is no built-in live web search, current-information feed, screen-image reasoning or tool execution in this local text path.
- Speed depends on the selected model, prompt, hardware, other apps and temperature. Initial loading and the first answer can be slower. There is no sub-second latency guarantee.
- Whisper can mishear accents, mixed languages, overlapping voices or low-quality audio. Text input is available when listening is unreliable.
- AI coaching and practice-feedback panels currently require the advanced Codex connection; selecting local AI does not make those features local.

## Devices

The distributed preview supports Apple silicon Macs, macOS 14.2 or newer. Start with Balanced on an M4 with 16 GB RAM. On an 8 GB M-series Mac, start with Smallest and close memory-heavy apps; this configuration is not certified by this release. Intel Mac, Windows and Linux desktop installers are not supplied.

## Failure and recovery

Keep Cue open during setup. Progress appears below the download choice. Cancel stops setup; retry reuses completed cached model files when available. After download, Cue tests a short generated answer before reporting ready. A failed or empty test releases the worker and suggests a smaller model or cloud AI. Setup does not prove every future answer will be accurate.

If local AI loses GPU access, restart Cue and close graphics-heavy applications. If the problem persists, use a smaller model or a cloud connection. Updating the app does not intentionally erase your saved context, credentials or model cache.

Sources checked 21 October 2026: [WebLLM](https://webllm.mlc.ai/docs/), [MLC Qwen3 1.7B](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC), [4B](https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC), [8B](https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC). Memory estimates also come from the pinned WebLLM package’s model records, not measurement of Cue on every device.
