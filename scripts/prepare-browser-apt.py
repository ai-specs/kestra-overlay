#!/usr/bin/env python3
"""Use signed official Ubuntu sources instead of the hosted runner mirror list."""
import pathlib
import re


def official_sources(text):
    def stanza(block):
        suites = re.search(r"^Suites:\s*(.+)$", block, re.M)
        security = suites and all(s.endswith("-security") for s in suites[1].split())
        target = "https://security.ubuntu.com/ubuntu" if security else "https://archive.ubuntu.com/ubuntu"
        return re.sub(
            r"^URIs:[ \t]*(?:mirror\+file:/etc/apt/apt-mirrors(?:-security)?\.txt|https?://azure\.archive\.ubuntu\.com/ubuntu)/?[ \t]*$",
            "URIs: " + target, block, flags=re.M,
        )
    updated = "\n\n".join(stanza(block) for block in text.split("\n\n"))
    for line in updated.splitlines():
        if line.startswith("URIs:") and ("azure.archive.ubuntu.com" in line or "mirror+file:" in line):
            raise ValueError("Unsupported hosted Ubuntu mirror URI format; refusing partial source configuration")
    return updated


def main():
    path = pathlib.Path("/etc/apt/sources.list.d/ubuntu.sources")
    if not path.is_file():
        raise SystemExit("Expected hosted Ubuntu deb822 sources are missing; refusing to guess sources")
    original = path.read_text()
    updated = official_sources(original)
    path.write_text(updated)
    print("Ubuntu browser dependencies: hosted mirror URIs absent; suites/components/signatures retained")


if __name__ == "__main__":
    main()
