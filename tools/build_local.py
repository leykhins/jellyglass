#!/usr/bin/env python3
"""Build dist/jellyglass.local.css: the theme with its fonts embedded, so it loads with no internet.

Needs the internet once, to download the fonts; they are cached in tools/.cache.
Requires fonttools and brotli:  pip install fonttools brotli

    python tools/build_local.py
"""

import base64
import io
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
SRC = ROOT / "theme" / "jellyglass.css"
ICONS = ROOT / "tools" / "icons.txt"
OUT = ROOT / "dist" / "jellyglass.local.css"

SYMBOLS = "https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/"
SYMBOLS_NAME = "MaterialSymbolsRounded[FILL,GRAD,opsz,wght]"
ONEST_CSS = "https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap"
# Google Fonts only serves woff2 to browsers it recognises
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def fetch(url: str) -> bytes:
    name = re.sub(r"[^A-Za-z0-9._-]", "_", url.split("://", 1)[1])[-120:]
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as res:
            path.write_bytes(res.read())
    return path.read_bytes()


def data_uri(blob: bytes, mime: str = "font/woff2") -> str:
    return f"url(data:{mime};base64,{base64.b64encode(blob).decode()}) format('woff2')"


def onest_faces() -> str:
    css = fetch(ONEST_CSS).decode()
    # Google lists the same variable file once per weight; embed each subset once with the full range
    seen = {}
    for name, face in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face\s*\{[^}]*\})", css):
        if name in ("latin", "latin-ext") and name not in seen:
            seen[name] = face
    if len(seen) != 2:
        sys.exit("Onest: latin faces not found in the Google Fonts response")
    faces = []
    for name, face in seen.items():
        url = re.search(r"url\(([^)]+)\)", face).group(1)
        face = re.sub(r"src:[^;]+;", f"src: local('Onest'), {data_uri(fetch(url))};", face)
        face = re.sub(r"font-weight:[^;]+;", "font-weight: 400 700;", face)
        faces.append(f"/* Onest, {name} */\n{face}")
    return "\n\n".join(faces)


def symbols_face() -> tuple[str, int, int]:
    names = [n.strip() for n in ICONS.read_text().splitlines() if n.strip() and not n.startswith("#")]
    codepoints = {}
    for line in fetch(SYMBOLS + urllib.parse.quote(SYMBOLS_NAME) + ".codepoints").decode().splitlines():
        name, cp = line.split()
        codepoints[name] = int(cp, 16)
    missing = [n for n in names if n not in codepoints]
    wanted = sorted({codepoints[n] for n in names if n in codepoints})

    font = TTFont(io.BytesIO(fetch(SYMBOLS + urllib.parse.quote(SYMBOLS_NAME) + ".woff2")))
    # One weight and size; keep the fill axis for the filled play, heart and star icons
    font = instancer.instantiateVariableFont(font, {"wght": 400, "GRAD": 0, "opsz": 24})
    # Round-trip so every table is fully loaded before subsetting
    tmp = io.BytesIO()
    font.flavor = None
    font.save(tmp)
    font = TTFont(io.BytesIO(tmp.getvalue()), lazy=False)

    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["liga", "rlig"]
    opts.layout_closure = False  # keep only ligatures whose icon is in the subset
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    # Letters, digits and underscore are the ligature inputs ("play_arrow")
    letters = [ord(c) for c in "abcdefghijklmnopqrstuvwxyz0123456789_"]
    sub.populate(unicodes=wanted + letters)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)

    if missing:
        print("not in Material Symbols, skipped:", " ".join(missing), file=sys.stderr)
    face = (
        "/* Material Symbols Rounded, subset to the icons in tools/icons.txt */\n"
        "@font-face {\n"
        '  font-family: "Material Symbols Rounded";\n'
        "  font-style: normal;\n"
        "  font-weight: 400;\n"
        "  font-display: block;\n"
        f"  src: {data_uri(buf.getvalue())};\n"
        "}"
    )
    return face, len(wanted), len(buf.getvalue())


def main() -> None:
    css = SRC.read_text()
    imports = re.findall(r'^@import url\("https://fonts\.googleapis\.com[^\n]*\n', css, flags=re.M)
    if len(imports) != 2:
        sys.exit(f"expected 2 Google Fonts @import lines in {SRC.name}, found {len(imports)}")
    for line in imports:
        css = css.replace(line, "")

    symbols, count, size = symbols_face()
    fonts = f"/* Fonts are embedded so the theme loads offline. Built by tools/build_local.py.\n   Onest: SIL Open Font License 1.1, https://openfontlicense.org\n   Material Symbols: Google, Apache License 2.0 */\n\n{onest_faces()}\n\n{symbols}\n"
    # @font-face goes after the header comment and before the first rule
    head, sep, rest = css.partition("*/\n")
    out = f"{head}{sep}\n{fonts}{rest}"

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(out)
    print(f"{OUT.relative_to(ROOT)}: {len(out) / 1024:.0f} KB ({count} icons, icon font {size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
