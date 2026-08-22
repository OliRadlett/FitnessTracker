#!/usr/bin/env python3
"""Fix double-encoded UTF-8 in fittrack.py.

Pattern: original UTF-8 bytes were decoded via Windows code page 1252 (cp1252),
then re-encoded to UTF-8.  This produces multi-char sequences like:
  â€"  (3 chars) which was originally  —  (em-dash, U+2014)

Strategy: read as UTF-8, try to re-encode each char via cp1252 to recover
original bytes, then decode those bytes as UTF-8.
"""
import os
import sys

os.environ["PYTHONIOENCODING"] = "utf-8"


def fix_file(path: str) -> int:
    data = open(path, "rb").read()

    # Remove BOM
    had_bom = data.startswith(b"\xef\xbb\xbf")
    if had_bom:
        data = data[3:]

    # Normalize CRLF → LF
    data = data.replace(b"\r\n", b"\n")

    text = data.decode("utf-8")

    # Walk through text collecting runs of cp1252-decodable chars.
    # When we hit a char NOT in cp1252 (or ASCII), flush the buffer.
    # cp1252 maps bytes 0x80-0x9F to specific Unicode chars, and 0xA0-0xFF
    # to U+00A0-U+00FF.  So any char whose codepoint is in cp1252's _output_
    # set could be a corrupted byte.
    #
    # Simpler approach: try to encode each run of high chars via cp1252 and
    # check if the result decodes as valid UTF-8.

    result = []
    buf = []
    fixed = 0

    def flush_buf():
        nonlocal fixed
        if not buf:
            return
        # Try to encode the buffered chars as cp1252
        try:
            raw = "".join(buf).encode("cp1252")
            decoded = raw.decode("utf-8")
            result.append(decoded)
            fixed += 1
        except (UnicodeDecodeError, UnicodeEncodeError):
            # Can't fix — keep original
            result.extend(buf)
        buf.clear()

    for ch in text:
        cp = ord(ch)
        if cp > 127:
            # Could be a corrupted byte from cp1252
            try:
                ch.encode("cp1252")
                buf.append(ch)
                continue
            except UnicodeEncodeError:
                pass
        flush_buf()
        result.append(ch)

    flush_buf()

    output = "".join(result).encode("utf-8")
    open(path, "wb").write(output)

    # Report
    msg = f"Fixed {fixed} corrupted sequences in {os.path.basename(path)}\n"
    if had_bom:
        msg = "Removed BOM. " + msg
    sys.stderr.write(msg)
    return fixed


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fix_file(os.path.join(root, "fittrack.py"))
