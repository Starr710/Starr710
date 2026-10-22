#!/usr/bin/env python3
"""Bundle SHADOW CELL into one self-contained HTML file.

  python3 tools/build_single.py                 -> dist/shadow-cell.html (full document, local three.js inlined)
  python3 tools/build_single.py --fragment OUT  -> body fragment that loads three.js from cdnjs (for hosted previews)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDN_THREE = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"


def scripts(html):
    block = re.search(r"<!-- SCRIPTS:START -->(.*?)<!-- SCRIPTS:END -->", html, re.S).group(1)
    return [ROOT / m for m in re.findall(r'src="([^"]+)"', block)]


def main():
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "css/style.css").read_text()
    js = "\n".join(p.read_text() for p in scripts(html))
    body = re.search(r"<!-- BODY:START -->(.*?)<!-- BODY:END -->", html, re.S).group(1)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)

    if len(sys.argv) > 2 and sys.argv[1] == "--fragment":
        out = pathlib.Path(sys.argv[2])
        page = (f'<title>Shadow Cell</title>\n<link rel="stylesheet" href="{fonts}">\n'
                f"<style>\n{css}\n</style>\n{body}\n<script src=\"{CDN_THREE}\"></script>\n<script>\n{js}\n</script>\n")
    else:
        out = ROOT / "dist/shadow-cell.html"
        three = (ROOT / "lib/three.min.js").read_text()
        head = html.split("<!-- BODY:START -->")[0]
        head = re.sub(r'<link rel="stylesheet" href="css/style.css">', f"<style>\n{css}\n</style>", head)
        page = f"{head}{body}\n<script>\n{three}\n</script>\n<script>\n{js}\n</script>\n</body>\n</html>\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    main()
