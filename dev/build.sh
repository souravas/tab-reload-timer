#!/usr/bin/env sh
# Package the extension for the Chrome Web Store.
# Includes only the files Chrome needs: manifest, service worker, popup, icons.
set -e
cd "$(dirname "$0")/.."

python3 - <<'EOF'
import json
import zipfile
from pathlib import Path

version = json.load(open("manifest.json"))["version"]
out = Path("dist") / f"tab-reload-timer-{version}.zip"
out.parent.mkdir(exist_ok=True)

include = ["manifest.json", "background.js", *Path("popup").rglob("*"), *Path("icons").rglob("*")]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in include:
        f = Path(f)
        if f.is_file() and f.name != ".DS_Store":
            z.write(f, f.as_posix())
print(f"wrote {out}")
EOF
