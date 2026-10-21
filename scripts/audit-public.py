#!/usr/bin/env python3
"""Audit distributable source defaults; run a dedicated secret scanner as well."""
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ignored = {".git", "node_modules", "dist", "native-build", "test-results", "coverage", "__pycache__"}
generated = {"public/device", "chatgpt-auth.bundle.mjs"}
text_types = {".js", ".mjs", ".cjs", ".json", ".py", ".swift", ".md", ".html", ".css", ".yml", ".yaml", ".toml", ".txt"}
secret_patterns = [
    re.compile(r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?:/Users/|C:\\Users\\)[A-Za-z0-9_.-]+"),
]
errors = []
files = []
for path in root.rglob("*"):
    relative = path.relative_to(root)
    if any(part in ignored for part in relative.parts) or any(str(relative) == g or str(relative).startswith(g + "/") for g in generated):
        continue
    if path.is_symlink():
        errors.append(f"Unexpected symlink: {relative}")
        continue
    if not path.is_file():
        continue
    files.append(path)
    if (path.name.startswith(".env") and path.name != ".env.example") or path.suffix in {".enc", ".pem", ".key", ".p8", ".p12", ".pfx"} or path.name in {"auth.json", "account.json", "owner.json"} or ".private" in relative.parts:
        errors.append(f"Private file: {relative}")
    if path.suffix in text_types or path.name == ".env.example":
        content = path.read_text(errors="replace")
        if any(pattern.search(content) for pattern in secret_patterns):
            errors.append(f"Credential or machine-specific path marker: {relative}")

seed = json.loads((root / "public/seed.json").read_text())
background = json.loads((root / "background.json").read_text())
if seed.get("profile") != "" or seed.get("firstRunSetup") is not True:
    errors.append("The first-run profile is not empty.")
if background.get("sources") or background.get("records") or background.get("applicationFields") or background.get("applicationSections"):
    errors.append("Bundled background contains user data.")
if "desktop-data.cjs" not in (root / "desktop.cjs").read_text():
    errors.append("The explicit Cue data selection helper is missing.")
if errors:
    print("Public source audit failed:\n" + "\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"Public source audit passed: {len(files)} files; blank profile; no credential or home-directory markers.")
