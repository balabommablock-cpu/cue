# Cue 1.31.0 validation

Checked on 21 October 2026. These are engineering checks, not a guarantee about every device, AI answer or meeting provider.

| Check | Result |
| --- | --- |
| Automated Node tests | 430 passed, no failures or skipped tests |
| npm dependency audit | No reported vulnerabilities at publication |
| Public defaults | Empty profile, no background records or sources, first-run setup enabled |
| Data isolation | Existing Cue identity retained; Community-only folders selected without copying or mixing accounts |
| Secret scan | Gitleaks source and packaged runtime scans; narrowly allowlisted upstream tokenizer code assignment |
| Packaged runtime inspection | No account, environment, owner-dashboard, development dependency or test files |
| Mac package | Apple silicon build; deep, strict ad-hoc signature verified |
| API provider tests | Encrypted persistence, concurrent key changes, removal, permission failures, model pagination, exact custom IDs, Responses/Chat compatibility, Claude streaming, interruption, truncation and credential IPC guards |
| Native smoke test | Fresh onboarding, memory-based local-model recommendation, disconnected account state |
| UI checks | Setup without context, prewritten example, reading presets, valid import and unsupported-field rejection |
| Capture behavior | Existing fail-closed controller tests pass; no new cross-provider receiving-device certification |

The UI example is explicitly prewritten. It is not an AI speed or quality benchmark. OpenAI/Claude API requests were verified with synthetic transport fixtures, not billed live API credentials. The release does not certify the provider’s model quality or latency. Speech recognition and model responses still require a live check on the recipient's Mac.

The Mac preview is not Developer ID signed or notarized. No Windows build is supplied. Share View does not promise universal invisibility; see [capture boundaries](SCREEN_SHARING.md).
