# Cue 1.33.3 validation

Checked on 27 October 2026.

- 524 automated checks passed with no failures or skips. Added coverage includes complete-opening display, append-only cue lines, provider prefix rewrites, hidden preparation/final-transcript agreement, changed constraints, changed candidate speech, Pause/Stop, failed previews, mixed-document evidence boundaries and hypothetical versus personal-advice routing.
- Mixed Markdown context packs now separate career evidence, relevant role/company reference and rehearsal sections. Answer banks, speculative interviewer profiles and embedded document instructions are excluded from ordinary answer evidence. The original documents remain local; missing historical facts remain missing. Relevant company context can support a new product case without injecting a CV.
- Six live GPT-6.1 Sol / Fast / low-effort cases used an actual supplied context pack. They covered a changed operational bottleneck, a commercial/platform trade-off, AI decision boundaries, tailored positioning, an unrelated concept/calculation and a challenge to the candidate's own stated metric. The outputs made new recommendations instead of copying the rehearsal bank. First provider text ranged from 1.7 to 2.6 seconds; complete opening lines from 2.1 to 3.5 seconds. These are text-provider timings, not full hardware latency.
- A separate replay used the exact packaged server, real local speech recognition, real Sol, HTTP interruption handling and the actual renderer in a simulated DOM. Three spoken questions arrived 250 ms apart after recognition. The latest answer retained the added operational constraints, an acknowledgement left it unchanged, and a subsequent question used the candidate's actual spoken metric. The first readable opening arrived about 2.4 seconds after the last supplied transcript. This does not certify physical microphone or Mac loopback capture.
- The fast cue path keeps the old card until a complete opening line is ready, then appends finished lines from the same generation. It does not race a cheap answer against a second rewrite. A rewritten opening is treated as an error and restores the previous card. Pause and question-audio guards remain active.
- Hidden preparation is bounded to one request and reused only when the final question, physical utterance identity and surrounding speech still match. Changed questions or new speech invalidate it. It can consume additional model quota when a preview is discarded. It is not a sub-second guarantee.
- Sol and Luna comparisons, supported-effort inspection and a live tier probe did not establish a reliable sub-second useful answer on the current Codex connection. The connection did not expose Ultrafast. A transport-only warm-up experiment was slower and was not adopted. The selected route remains Sol Fast with low effort.
- The installed 1.33.3 modules matched source hashes. Public source and extracted runtime secret scans, the blank seed audit, package checksums and deep/strict ad-hoc signature passed. Private accounts, context and model caches were retained.
- Native recording access was refreshed for the installed build. Automated native audio starts stalled, including an independent microphone attempt; a direct user-click check remains pending. Physical audio observations below are historical 1.33.2 results and do not certify 1.33.3.

The latency target of a useful answer under one second was not met on the selected connection. Shared microphone speaker attribution and AI answer quality remain bounded by audio and model limitations.

## Earlier 1.33.2 checks

Checked on 27 October 2026.

- 492 automated checks passed with no failures or skips. Conversation regressions cover long pauses, unfinished scenario setup, multipart questions, backchannels, real candidate speech, provisional speech during interruptions, interviewer corrections, explicit topic changes, stale completed drafts, and overlapping microphone/computer transcripts.
- Actual spoken turns now travel separately from generated suggestions in every text-provider path. The in-memory conversation ledger is bounded and cleared on Stop/session change; it is not saved as biography or confirmed fact. Requests include at most eight selected speech entries and 8,000 characters.
- A full software voice replay used real local MLX Whisper, real Sol Fast requests, the renderer and its actual stream decoder. The scenario preface made no answer request; the candidate’s own response kept the existing answer; the next answer defended that stated choice; an interruption changed the cash constraint from six months to three weeks. Three answer requests completed. In the final repeat, first provider text took 1.6–3.2 seconds and completion 3.6–6.1 seconds. ASR for those fixture clips took about 0.1–0.3 seconds warm. This is a software/audio-fixture test, not a full hardware latency benchmark.
- Physical combined capture on the 1.33.2 candidate registered Mac loopback at 0.862 and the Brio room microphone at 0.073 during sustained Mac speaker playback. The native reader waited for a paused case question, retained the previous card while a follow-up drafted, and updated the answer for a three-week cash interruption, without showing thinking text. This test also exposed duplicate cross-input transcripts; the final correction has regression coverage for spoken numbers versus digits, both arrival orders, fuzzy room echoes, genuine added requests and changed negations.
- The final installed build also passed a physical shared-microphone replay: case preface held, complete question answered, candidate speech left the answer unchanged, and the follow-up explicitly retained the candidate’s stated unchanged-price choice. The previous card stayed visible during drafting and no thinking text appeared. This uses synthetic spoken clips through Mac speakers into the Brio microphone, not independent simultaneous human speakers.
- Final combined-capture verification also passed after a clean reopen: Mac loopback registered 0.874 and Brio microphone 0.300 during the same spoken case. Earlier answers contained exactly one combined case/question card, including both requested parts, with no duplicate echo card. Both meters returned to Off on Stop; Mac + phone / room remained selected. Native control briefly timed out during the preceding reopen and recovered when the installed app was opened through Finder.
- Public source and extracted installed-runtime secret scans passed. The installed conversation modules matched source hashes. The DMG checksum and deep/strict ad-hoc signature were checked. Private account/context/cache remain local and are not included in packages.

Shared-microphone speaker attribution is based on language and context, not biometric speaker identification. Background speech, poor audio and simultaneous voices can still be misheard. No sub-second or perfect conversational-understanding guarantee is made. The Mac preview remains ad-hoc signed and is not Apple notarized.

## Earlier 1.33.1 checks

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
