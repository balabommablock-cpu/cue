# Cue 1.33.1 validation

Checked on 27 October 2026. These are bounded engineering observations, not a latency or device guarantee.

- 469 automated checks passed, with no failures or skipped tests. The added scenarios cover backchannels, candidate speech, partial and failed follow-ups, a superseding challenge, rephrasing, typed follow-ups, Pause, Stop, timeouts and late responses.
- The actual Codex stream is passed through the renderer decoder in regression testing. Model selection metadata is kept separate from numeric timing values; malformed timing cannot silently count as a successful answer.
- Six live GPT-6.1 Sol / Fast / low-effort questions covered a product case, a follow-up, unit economics, a multipart metric question, a challenge and missing personal facts. All completed. First useful answer text ranged from 1.4 to 4.6 seconds (median 2.0); complete answers ranged from 2.7 to 6.8 seconds (median 3.9). Startup preparation took 4.2 seconds separately. These were sequential text-provider observations on one Mac, not full live-audio latency or a representative distribution.
- A second live numerical follow-up check retained the preceding case: doubling CAC from ₹1,500 to ₹3,000 correctly changed payback from five to ten months and LTV:CAC to 1:1. Its first text took 1.7 seconds and completion 3.3 seconds.
- The installed native 1.33.1 app generated the calculation and numerical follow-up. During drafting, the previous answer remained visible and no thinking text appeared; the completed replacement then showed the correct numbers. The answer remained present after the timing and completion events. The owner’s existing context and account were retained. Sol Fast was verified in native Settings.
- The installed native recorded-voice test passed with Codex and locally cached MLX Whisper after restoring its missing model weights. It performed real transcription and generated a cue answer; microphone and system capture were off in this sample test.
- Both local speech-decoder lanes transcribed the included recording correctly in parallel: cold preparation plus transcription took 1.74 seconds, and the warm two-lane transcription took 138 ms. A silent clip returned no transcript. This checks decoder concurrency, not physical microphone/system capture.
- Live combined microphone/computer capture on the updated build reached the macOS recording-permission gate. The recorded-voice result above does not certify physical inputs; the updated app needs Screen & System Audio Recording consent before that check can finish.
- Cue’s first answer streams; subsequent answer drafts stay hidden until completion. Brief acknowledgements do not replace the answer. Explicit Pause and editing still hold an answer for review. Short what-if follow-ups keep a bounded recent snapshot; an unrelated new topic excludes previous answers and career material.
- Thinking/commentary model events and leading think/analysis blocks are excluded. The live reader hides its former progress strip and slow-answer narration. Actual failures remain visible with retry.

The earlier tests below remain historical checks, with their original dates and versions. Physical audio and sharing results from 1.33.0 are not new certifications for 1.33.1. The Mac preview remains ad-hoc signed and is not Apple notarized.

## Earlier 1.33.0 checks

Checked on 21 October 2026. These are engineering checks, not a guarantee about every device, AI answer or meeting provider.

| Check | Result |
| --- | --- |
| Automated Node tests | 447 passed, no failures or skipped tests |
| npm dependency audit | No reported vulnerabilities at publication |
| Public defaults | Empty profile, no background records or sources, first-run setup enabled |
| Data isolation | Existing Cue identity retained; Community-only folders selected without copying or mixing accounts |
| Secret scan | Gitleaks source and packaged runtime scans; narrowly allowlisted upstream tokenizer code assignment |
| Packaged runtime inspection | No account, environment, owner-dashboard, development dependency or test files |
| Mac package | Apple silicon ZIP and DMG; read-only DMG mount contains a signed Cue app, Applications shortcut and installation help; deep, strict ad-hoc signature verified |
| API provider tests | Encrypted persistence, concurrent key changes, removal, permission failures, model pagination, exact custom IDs, Responses/Chat compatibility, Claude streaming, interruption, truncation and credential IPC guards |
| Native smoke test | Installed 1.33.0 opened after unlock with the saved profile, confirmed its version in Settings, loaded the cached local model and passed the sample-voice test. Clean shutdown and restart passed; setup could be opened during model startup. Prior 1.31.0 checks retained context/account and verified invalid-key handling. |
| Real local inference | Clean UI profile downloaded Qwen3 1.7B plus Whisper; generated self-test, a normal answer, correct ₹250 × 12 arithmetic and a missing-history response that did not invent employers on Apple M4 Max, 36 GB RAM |
| Installed native local AI | Distributed 1.33.0 loaded cached Qwen3 8B and Whisper, transcribed the included recording and generated an answer; UI reported 3.3 seconds to first text in that single sample-voice test. Prior 1.32.0 generated a typed answer at a displayed 0.8 seconds; these are different tests, not directly comparable benchmarks. |
| Physical microphone and Mac audio | Installed 1.33.0 opened the Brio 100 microphone and Mac loopback separately, then together in Mac + phone / room mode. A spoken test played through Mac Studio speakers was picked up in microphone-only mode and answered; system-only playback was also answered. With both sources enabled, the computer input registered audio, the room meter moved and the spoken test received an answer. Stop returned both meters to Off. |
| Cached startup | Local model and speech reloaded from the clean profile cache and reported ready, with recording off |
| Windows portable checks | GitHub Actions Windows runner installed dependencies, built assets and passed selected model/runtime/renderer tests; no Windows desktop or GPU certification |
| UI checks | Setup without context, model recommendation and recovery, interrupted downloads, late completion guards, disabled navigation during setup, source choice without recording, typed and sample-voice tests |
| Capture behavior | Existing fail-closed controller tests pass; no new cross-provider receiving-device certification |

The UI example is explicitly prewritten. It is not an AI speed or quality benchmark. OpenAI/Claude API requests were verified with synthetic transport fixtures, not billed live API credentials. The release does not certify the provider’s model quality or latency. Speech recognition and model responses still require a live check on the recipient's Mac.

The Mac preview is not Developer ID signed or notarized. No Windows build is supplied. Share View does not promise universal invisibility; see [capture boundaries](SCREEN_SHARING.md).

Observed UI time to first text in this small Qwen3 1.7B check varied from 0.2 seconds for a general or missing-context answer to 4.4 seconds for the arithmetic prompt. These are individual observations on one Mac, not a latency distribution or device guarantee. Tests used the built UI in a clean browser profile; physical speech accuracy and a fresh recipient Mac remain separate checks.

The new sample-voice entry point was checked in the real built UI using cached Qwen3 1.7B and Whisper: the included recording was transcribed and answered, with no microphone or system capture. The displayed 2.7 seconds to first answer text was one observation, not a latency guarantee. The sample test does not certify physical audio or macOS permissions.

The installed 1.33.0 native app was checked after unlocking the Mac. Its sample-voice flow used cached Qwen3 8B and Whisper, showed an answer and was stopped afterward. Both capture meters remained off. An initial accessibility-control timeout during model startup did not reproduce on a clean restart; it is not evidence of a crash or a completed physical-audio test. Cue was left open with local AI ready and recording off.

Fresh first-use browser checks confirmed setup resumes at the saved AI step, choices stay collapsed until requested, navigation is disabled during a real download, and both closing and cancelling stop setup without marking a model ready. A regression test covers the asynchronous cancellation badge refresh.

The later live-audio check required refreshing stale Cue entries in macOS recording settings and approving the current installed app. Startup initially waited or returned an ended source during this permission transition. After approval and restarting, physical microphone, system-only and combined capture all worked. The system-only test displayed 3.4 seconds from speech end to first text once. Both-source testing used Mac speaker playback plus the room microphone; it does not certify independent overlapping speakers, a separate phone, every microphone or every meeting provider. Ambient speech/noise can still be misinterpreted. Capture was stopped after each test; no microphone recording was saved.
