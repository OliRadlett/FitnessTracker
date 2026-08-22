#!/usr/bin/env python3
"""Download the full Whoop Developer API documentation and save as agent-readable Markdown.

Targets:
  - https://developer.whoop.com/docs/introduction  (and all /docs/* pages)
  - https://developer.whoop.com/api                 (API reference — Redoc-rendered)

Output: docs/whoop-api/ directory with one .md file per page, plus an INDEX.md.

Usage:
    python scripts/download_whoop_docs.py
"""

from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as md

# ── Config ──────────────────────────────────────────────────────────────────

BASE_URL = "https://developer.whoop.com"
SITEMAP_URL = f"{BASE_URL}/sitemap.xml"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "whoop-api"
REQUEST_DELAY = 0.5  # polite delay between requests (seconds)
REQUEST_TIMEOUT = 30

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Pages to skip (not documentation content)
SKIP_PATTERNS = [
    "/api-terms-of-use",
    "/open-api",
]

# ── Helpers ─────────────────────────────────────────────────────────────────


def fetch(url: str) -> requests.Response:
    """Fetch a URL with retries."""
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt == 2:
                raise
            print(f"  Retry {attempt + 1} for {url}: {e}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}")


def get_sitemap_urls() -> list[str]:
    """Parse sitemap.xml and return all documentation URLs."""
    resp = fetch(SITEMAP_URL)
    root = ET.fromstring(resp.text)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = []
    for url_elem in root.findall("s:url", ns):
        loc = url_elem.find("s:loc", ns)
        if loc is not None and loc.text:
            urls.append(loc.text.rstrip("/"))
    return urls


def slug_to_filename(url: str) -> str:
    """Convert a URL path to a flat filename.

    Examples:
        /docs/introduction           -> introduction.md
        /docs/developing/oauth       -> developing-oauth.md
        /docs/tutorials/             -> tutorials.md
        /api                         -> api-reference.md
    """
    path = url.replace(BASE_URL, "").strip("/")
    if not path:
        return "index.md"
    # Replace slashes with dashes
    slug = path.replace("/", "-")
    # Sanitize
    slug = re.sub(r"[^a-zA-Z0-9_-]", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{slug}.md"


def extract_docusaurus_content(soup: BeautifulSoup) -> str | None:
    """Extract the main article content from a Docusaurus page.

    Tries multiple selectors in priority order:
    1. .markdown (Docusaurus doc pages)
    2. article (generic)
    3. .theme-doc-markdown
    4. [role='main']
    """
    for selector in [
        ".markdown",
        "article .markdown",
        ".theme-doc-markdown",
        "article",
        "[role='main']",
    ]:
        el = soup.select_one(selector)
        if el and len(el.get_text(strip=True)) > 50:
            return str(el)
    return None


def extract_api_reference(soup: BeautifulSoup) -> str | None:
    """Try to extract the API reference content from the /api page.

    The /api page renders Redoc, which is JS-driven. We look for:
    1. Any embedded OpenAPI spec in <script> tags
    2. The raw HTML structure Redoc creates
    3. Fallback to full page body content
    """
    # Look for embedded spec URL in scripts
    for script in soup.find_all("script"):
        if script.string and ("specUrl" in script.string or "openapi" in script.string.lower()):
            # Try to extract the spec URL
            match = re.search(r'(?:specUrl|url)\s*[:=]\s*["\']([^"\']+)["\']', script.string)
            if match:
                return f"[OpenAPI Spec URL found: {match.group(1)}]"

    # Try Redoc container
    redoc = soup.select_one("redoc, [data-redoc], .redoc-wrap, #redoc-container")
    if redoc:
        return str(redoc)

    # Try the main content area
    main = soup.select_one("main, [role='main']")
    if main and len(main.get_text(strip=True)) > 50:
        return str(main)

    return None


def extract_sidebar_links(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """Extract sidebar navigation links from the Docusaurus page."""
    links = []
    for a in soup.select("aside a[href], .menu a[href], .theme-doc-sidebar-menu a[href]"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href and text and not href.startswith("http"):
            links.append((text, href))
    return links


def html_to_markdown(html_content: str, page_title: str) -> str:
    """Convert HTML content to clean Markdown."""
    soup = BeautifulSoup(html_content, "html.parser")

    # Remove unwanted elements
    for tag in soup.find_all(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Remove edit links, pagination, etc.
    for cls_pattern in ["edit-page", "pagination", "theme-edit-this-page", "table-of-contents__left-border"]:
        for tag in soup.find_all(class_=re.compile(cls_pattern)):
            tag.decompose()

    # Process code blocks to preserve language hints
    for pre in soup.find_all("pre"):
        code = pre.find("code")
        if code:
            classes = code.get("class", [])
            lang = ""
            for cls in classes:
                if cls.startswith("language-") or cls.startswith("lang-"):
                    lang = cls.split("-", 1)[1]
                    break
            if lang:
                code["class"] = [f"language-{lang}"]

    # Convert to markdown
    markdown = md(
        str(soup),
        heading_style="atx",
        code_language_callback=lambda el: next(
            (cls.split("-", 1)[1] for cls in (el.get("class") or []) if cls.startswith("language-")),
            None,
        ),
        strip=["img"],  # Remove images (they'd be broken links)
    )

    # Clean up excessive whitespace
    markdown = re.sub(r"\n{4,}", "\n\n\n", markdown)
    markdown = re.sub(r"[ \t]+$", "", markdown, flags=re.MULTILINE)

    return markdown.strip()


def extract_api_endpoint_details(soup: BeautifulSoup) -> str:
    """Extract API endpoint information from the /api Redoc page.

    The Docusaurus HTML for the API page contains the Redoc-rendered content
    which includes endpoint details in the server-rendered HTML.
    """
    # Look for operation sections (Redoc renders these as sections with data-section-id)
    sections = []
    for section in soup.find_all("section"):
        section_id = section.get("id", "")
        data_section = section.get("data-section-id", "")
        if section_id or data_section:
            heading = section.find(re.compile(r"^h[1-6]$"))
            heading_text = heading.get_text(strip=True) if heading else ""
            content = section.get_text(separator="\n", strip=True)
            if len(content) > 20:
                sections.append(f"### {heading_text or section_id or data_section}\n\n{content}")

    if sections:
        return "\n\n---\n\n".join(sections)

    # Fallback: extract all text from main content
    main = soup.select_one("main, [role='main'], .api-content, .redoc-wrap")
    if main:
        return main.get_text(separator="\n", strip=True)

    return soup.get_text(separator="\n", strip=True)


# ── Main download logic ────────────────────────────────────────────────────


def download_docs() -> None:
    """Download all Whoop developer documentation."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching sitemap...")
    all_urls = get_sitemap_urls()
    print(f"Found {len(all_urls)} URLs in sitemap")

    # Filter to documentation URLs
    doc_urls = [u for u in all_urls if "/docs/" in u]
    # Add the API reference page
    api_url = f"{BASE_URL}/api"

    index_entries: list[tuple[str, str, str]] = []  # (section, title, filename)

    # ── Download docs pages ─────────────────────────────────────────────────
    print(f"\nDownloading {len(doc_urls)} documentation pages...")
    for i, url in enumerate(doc_urls):
        time.sleep(REQUEST_DELAY)
        print(f"  [{i+1}/{len(doc_urls)}] {url}")

        try:
            resp = fetch(url)
        except Exception as e:
            print(f"    ERROR: {e}")
            continue

        soup = BeautifulSoup(resp.text, "html.parser")

        # Extract title
        title_el = soup.find("h1")
        title = title_el.get_text(strip=True) if title_el else slug_to_filename(url).replace(".md", "").replace("-", " ").title()

        # Extract main content
        content_html = extract_docusaurus_content(soup)
        if not content_html:
            print("    WARNING: No content found, using full body")
            body = soup.find("body")
            content_html = str(body) if body else resp.text

        # Convert to markdown
        markdown = html_to_markdown(content_html, title)

        # Add frontmatter-style header
        header = f"# {title}\n\n"
        header += f"> Source: {url}\n\n---\n\n"

        full_content = header + markdown

        # Save file
        filename = slug_to_filename(url)
        filepath = OUTPUT_DIR / filename
        filepath.write_text(full_content, encoding="utf-8")
        print(f"    Saved: {filename} ({len(full_content)} chars)")

        # Track for index
        section = url.split("/docs/")[-1].split("/")[0] if "/docs/" in url else "other"
        index_entries.append((section, title, filename))

    # ── Download API reference page ─────────────────────────────────────────
    print(f"\nDownloading API reference: {api_url}")
    time.sleep(REQUEST_DELAY)

    try:
        resp = fetch(api_url)
        soup = BeautifulSoup(resp.text, "html.parser")

        title = "WHOOP API Reference"
        title_el = soup.find("h1")
        if title_el:
            title = title_el.get_text(strip=True)

        # Try to extract structured API content
        api_content = extract_api_endpoint_details(soup)

        # Also look for sidebar links that enumerate endpoints
        sidebar_links = extract_sidebar_links(soup)
        endpoint_links = [l for l in sidebar_links if "/api/" in l[1] or "get" in l[0].lower() or "post" in l[0].lower()]

        header = f"# {title}\n\n"
        header += f"> Source: {api_url}\n\n"
        header += "This page was extracted from the Whoop Developer API reference page.\n"
        header += "The API is documented at https://developer.whoop.com/api using Redoc.\n\n"

        if endpoint_links:
            header += "## Known Endpoints\n\n"
            for link_text, link_href in endpoint_links:
                header += f"- [{link_text}]({BASE_URL}{link_href})\n"
            header += "\n---\n\n"

        full_content = header + "## API Content\n\n" + api_content

        filename = "api-reference.md"
        filepath = OUTPUT_DIR / filename
        filepath.write_text(full_content, encoding="utf-8")
        print(f"  Saved: {filename} ({len(full_content)} chars)")

        index_entries.append(("api", title, filename))

    except Exception as e:
        print(f"  ERROR fetching API reference: {e}")

    # ── Also try to fetch individual API sub-pages from sidebar ──────────────
    # The /api page may have links to individual endpoint docs
    # Let's also try common API doc patterns
    print("\nChecking for individual API endpoint pages...")
    # The API page is rendered by Redoc, but Docusaurus might have sub-pages
    # Check for /api/* paths by looking at the sidebar links we extracted
    try:
        resp = fetch(api_url)
        soup = BeautifulSoup(resp.text, "html.parser")
        sidebar_links = extract_sidebar_links(soup)
        api_sub_urls = []
        for link_text, link_href in sidebar_links:
            if link_href.startswith("/api/") and link_href != "/api/":
                full_url = BASE_URL + link_href
                if full_url not in [u for u in all_urls]:
                    api_sub_urls.append((link_text, full_url))

        if api_sub_urls:
            print(f"  Found {len(api_sub_urls)} API sub-pages from sidebar")
            for link_text, url in api_sub_urls:
                time.sleep(REQUEST_DELAY)
                print(f"  Fetching: {link_text} -> {url}")
                try:
                    sub_resp = fetch(url)
                    sub_soup = BeautifulSoup(sub_resp.text, "html.parser")
                    content_html = extract_docusaurus_content(sub_soup) or sub_resp.text
                    markdown = html_to_markdown(content_html, link_text)
                    header = f"# {link_text}\n\n> Source: {url}\n\n---\n\n"
                    full_content = header + markdown
                    filename = slug_to_filename(url)
                    filepath = OUTPUT_DIR / filename
                    filepath.write_text(full_content, encoding="utf-8")
                    print(f"    Saved: {filename}")
                    index_entries.append(("api", link_text, filename))
                except Exception as e:
                    print(f"    ERROR: {e}")
        else:
            print("  No individual API sub-pages found in sidebar")
    except Exception as e:
        print(f"  ERROR checking API sub-pages: {e}")

    # ── Generate INDEX.md ───────────────────────────────────────────────────
    print("\nGenerating INDEX.md...")

    # Sort by section then title
    index_entries.sort(key=lambda x: (x[0], x[1]))

    index_content = "# WHOOP Developer API Documentation (Offline Reference)\n\n"
    index_content += "Downloaded from https://developer.whoop.com on "
    index_content += time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()) + ".\n\n"
    index_content += "This directory contains the full Whoop Developer Platform documentation\n"
    index_content += "converted to agent-readable Markdown format.\n\n"
    index_content += "**Original source:** https://developer.whoop.com\n\n"
    index_content += "---\n\n"

    current_section = ""
    for section, title, filename in index_entries:
        if section != current_section:
            section_titles = {
                "introduction": "Getting Started",
                "developing": "Developer Guide",
                "partner": "Partner Integration",
                "tutorials": "Tutorials",
                "api": "API Reference",
                "other": "Other",
            }
            index_content += f"## {section_titles.get(section, section.title())}\n\n"
            current_section = section
        index_content += f"- [{title}]({filename})\n"

    index_content += "\n---\n\n"
    index_content += "## Quick Reference\n\n"
    index_content += "**Base URL:** `https://api.prod.whoop.com`\n\n"
    index_content += "**Authentication:** OAuth 2.0 Bearer tokens\n\n"
    index_content += "**Scopes:** `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, `read:profile`, `read:body_measurement`\n\n"
    index_content += "**Pagination:** Cursor-based via `next_token` parameter (max 25 records per page)\n\n"
    index_content += "**Rate Limiting:** See [rate-limiting](developing-rate-limiting.md)\n\n"

    filepath = OUTPUT_DIR / "INDEX.md"
    filepath.write_text(index_content, encoding="utf-8")
    print(f"Saved: INDEX.md ({len(index_content)} chars)")

    print(f"\n{'='*60}")
    print(f"Done! Downloaded {len(index_entries)} pages to {OUTPUT_DIR}")
    print(f"Index file: {OUTPUT_DIR / 'INDEX.md'}")
    print(f"{'='*60}")


if __name__ == "__main__":
    download_docs()
