# Security

Never include API keys, account tokens, private notes, recordings, CVs, screenshots containing private material, or environment files in an issue or pull request.

Use GitHub's private vulnerability reporting on this repository when available. Otherwise open a minimal issue asking for a private reporting channel without publishing exploit details or credentials.

Before publishing a change, run `npm run audit:public` and a secret scanner such as `gitleaks dir --redact .`. Review the actual staged diff. `.gitignore` is a guard, not proof that a file is safe to publish.

## Boundaries

- Your own locally encrypted account store is outside the repository and is never a distributable.
- Context and model files are user data, not fixtures. Only synthetic test data belongs in tests.
- Preference import is an allowlist with size, type, range and schema checks. It cannot import an account, context file, key or executable code.
- Share View filters only its own picture. It does not protect another recorder, process enumeration or an independent display capture.
- Stop ends capture. Hiding the window keeps listening active. Sleep/lock interruptions stop the session.
- The app is not an assurance for restricted assessments. Respect the rules of the conversation or environment.

The current preview is not Developer ID signed or notarized. Publishing a source repository does not change that distribution limitation.
