# Cue 1.33.0 validation

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
