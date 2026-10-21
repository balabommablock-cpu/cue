# Community 1.30.1 validation

Checked on 21 October 2026. These are engineering checks, not a guarantee about every device, AI answer or meeting provider.

| Check | Result |
| --- | --- |
| Automated Node tests | 404 passed, no failures or skipped tests |
| npm dependency audit | No reported vulnerabilities at publication |
| Public defaults | Empty profile, no background records or sources, first-run setup enabled |
| Data isolation | Separate Community data directory and bundle identifiers |
| Secret scan | Gitleaks source and packaged runtime scans; narrowly allowlisted upstream tokenizer code assignment |
| Packaged runtime inspection | No account, environment, owner-dashboard, development dependency or test files |
| Mac package | Apple silicon build; deep, strict ad-hoc signature verified |
| Native smoke test | Fresh onboarding, memory-based local-model recommendation, disconnected account state |
| UI checks | Setup without context, prewritten example, reading presets, valid import and unsupported-field rejection |
| Capture behavior | Existing fail-closed controller tests pass; no new cross-provider receiving-device certification |

The UI example is explicitly prewritten. It is not an AI speed or quality benchmark. This release did not sign in to a real user's cloud account, download model weights, or record a live conversation. Speech recognition and model responses still require a live check on the recipient's Mac.

The Mac preview is not Developer ID signed or notarized. No Windows build is supplied. Share View does not promise universal invisibility; see [capture boundaries](SCREEN_SHARING.md).
