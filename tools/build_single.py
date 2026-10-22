#!/usr/bin/env python3
"""Bundle SHADOW CELL into one self-contained HTML file.

  python3 tools/build_single.py [page.html]                 -> dist/<page>.html (full document, libraries inlined)
  python3 tools/build_single.py --fragment OUT [page.html]  -> body fragment that loads libraries from CDNs (hosted previews)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDN = {
    "lib/three.min.js": "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "lib/GLTFLoader.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
}


def scripts(html):
    block = re.search(r"<!-- SCRIPTS:START -->(.*?)<!-- SCRIPTS:END -->", html, re.S).group(1)
    return [ROOT / m for m in re.findall(r'src="([^"]+)"', block)]


def libs(html):
    head = html.split("<!-- SCRIPTS:START -->")[0].split("<!-- BODY:END -->")[1]
    return re.findall(r'src="(lib/[^"]+)"', head)


def main():
    args = sys.argv[1:]
    fragment = None
    if args[:1] == ["--fragment"]:
        fragment, args = pathlib.Path(args[1]), args[2:]
    page_name = args[0] if args else "index.html"
    html = (ROOT / page_name).read_text()
    css_href = re.search(r'<link rel="stylesheet" href="(css/[^"]+)">', html).group(1)
    css = (ROOT / css_href).read_text()
    js = "\n".join(p.read_text() for p in scripts(html))
    body = re.search(r"<!-- BODY:START -->(.*?)<!-- BODY:END -->", html, re.S).group(1)
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)

    title = re.search(r"<title>(.*?)</title>", html).group(1)
    lib_list = libs(html)
    if fragment:
        out = fragment
        tags = "".join(f'<script src="{CDN[l]}"></script>\n' for l in lib_list)
        page = (f'<title>{title}</title>\n<link rel="stylesheet" href="{fonts}">\n'
                f"<style>\n{css}\n</style>\n{body}\n{tags}<script>\n{js}\n</script>\n")
    else:
        out = ROOT / "dist" / ("shadow-cell.html" if page_name == "index.html" else page_name)
        inlined = "".join(f"<script>\n{(ROOT / l).read_text()}\n</script>\n" for l in lib_list)
        head = html.split("<!-- BODY:START -->")[0]
        head = head.replace(f'<link rel="stylesheet" href="{css_href}">', f"<style>\n{css}\n</style>")
        page = f"{head}{body}\n{inlined}<script>\n{js}\n</script>\n</body>\n</html>\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print(f"wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    main()
