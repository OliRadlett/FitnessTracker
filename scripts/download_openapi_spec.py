"""Download the Whoop OpenAPI spec and convert to structured agent-readable Markdown."""
import json
import time
from pathlib import Path

import requests

SPEC_URL = "https://api.prod.whoop.com/developer/doc/openapi.json"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "whoop-api"


def write_schema_ref(parts: list[str], schema: dict, schemas: dict, depth: int = 0) -> None:
    """Recursively write schema details."""
    indent = "  " * depth
    if "$ref" in schema:
        ref_name = schema["$ref"].split("/")[-1]
        parts.append(f"{indent}- Schema: [`{ref_name}`](#{ref_name.lower().replace('_', '-')})")
        return
    stype = schema.get("type", "object")
    parts.append(f"{indent}- Type: `{stype}`")
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    for pname, prop in props.items():
        req = " (required)" if pname in required else ""
        pt = prop.get("type", "")
        if "$ref" in prop:
            pt = prop["$ref"].split("/")[-1]
        desc = prop.get("description", "")
        parts.append(f"{indent}  - `{pname}`{req}: {pt} — {desc}")


def download_and_convert() -> None:
    """Download OpenAPI spec and produce structured Markdown."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    print(f"Downloading OpenAPI spec from {SPEC_URL}...")
    resp = requests.get(SPEC_URL, headers=headers, timeout=30)
    resp.raise_for_status()
    spec = resp.json()

    # Save raw JSON
    raw_path = OUTPUT_DIR / "openapi-spec.json"
    raw_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(f"Saved raw spec: {raw_path} ({len(resp.text)} chars)")

    info = spec.get("info", {})
    servers = spec.get("servers", [])
    paths = spec.get("paths", {})
    components = spec.get("components", {})
    schemas = components.get("schemas", {})
    security_schemes = components.get("securitySchemes", {})
    tags = spec.get("tags", [])

    md_parts: list[str] = []

    # Header
    md_parts.append(f"# {info.get('title', 'WHOOP API')} — OpenAPI Reference")
    md_parts.append("")
    md_parts.append(f"> **Version:** {info.get('version', 'unknown')}")
    md_parts.append(f"> **Source:** {SPEC_URL}")
    md_parts.append(f"> **Downloaded:** {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    md_parts.append("")
    if info.get("description"):
        md_parts.append(info["description"])
        md_parts.append("")

    # Servers
    md_parts.append("## Servers")
    md_parts.append("")
    for srv in servers:
        md_parts.append(f"- `{srv.get('url')}` — {srv.get('description', '')}")
    md_parts.append("")

    # Security
    md_parts.append("## Authentication")
    md_parts.append("")
    for scheme_name, scheme in security_schemes.items():
        md_parts.append(f"### {scheme_name}")
        md_parts.append("")
        md_parts.append(f"- **Type:** {scheme.get('type', 'N/A')}")
        if "flows" in scheme:
            for flow_type, flow in scheme["flows"].items():
                md_parts.append(f"- **Flow:** {flow_type}")
                if "authorizationUrl" in flow:
                    md_parts.append(f"  - Authorization URL: `{flow['authorizationUrl']}`")
                if "tokenUrl" in flow:
                    md_parts.append(f"  - Token URL: `{flow['tokenUrl']}`")
                if "refreshUrl" in flow:
                    md_parts.append(f"  - Refresh URL: `{flow['refreshUrl']}`")
                if "scopes" in flow:
                    md_parts.append("  - Scopes:")
                    for scope_name, scope_desc in flow["scopes"].items():
                        md_parts.append(f"    - `{scope_name}` — {scope_desc}")
        md_parts.append("")

    # Group endpoints by tag
    tag_map: dict[str, list[dict]] = {}
    for path_key, methods in paths.items():
        for method, detail in methods.items():
            if method in ("get", "post", "put", "patch", "delete", "head", "options"):
                endpoint_tags = detail.get("tags", ["Untagged"])
                for t in endpoint_tags:
                    tag_map.setdefault(t, []).append({
                        "method": method.upper(),
                        "path": path_key,
                        "summary": detail.get("summary", ""),
                        "description": detail.get("description", ""),
                        "operationId": detail.get("operationId", ""),
                        "parameters": detail.get("parameters", []),
                        "requestBody": detail.get("requestBody"),
                        "responses": detail.get("responses", {}),
                        "security": detail.get("security", []),
                        "deprecated": detail.get("deprecated", False),
                    })

    tag_descriptions = {t.get("name", ""): t.get("description", "") for t in tags}

    # Endpoints
    md_parts.append("## Endpoints")
    md_parts.append("")

    for tag_name, endpoints in sorted(tag_map.items()):
        tag_desc = tag_descriptions.get(tag_name, "")
        md_parts.append(f"### {tag_name}")
        if tag_desc:
            md_parts.append(f"\n{tag_desc}")
        md_parts.append("")

        for ep in endpoints:
            deprecated = " ⚠️ DEPRECATED" if ep["deprecated"] else ""
            md_parts.append(f"#### `{ep['method']}` {ep['path']}{deprecated}")
            md_parts.append("")
            if ep["summary"]:
                md_parts.append(f"**{ep['summary']}**")
                md_parts.append("")
            if ep["description"]:
                md_parts.append(ep["description"])
                md_parts.append("")
            if ep["operationId"]:
                md_parts.append(f"**Operation ID:** `{ep['operationId']}`")
                md_parts.append("")

            # Security
            if ep["security"]:
                scopes = []
                for sec in ep["security"]:
                    for scheme_scopes in sec.values():
                        scopes.extend(scheme_scopes)
                if scopes:
                    md_parts.append(f"**Required scopes:** {', '.join(f'`{s}`' for s in scopes)}")
                    md_parts.append("")

            # Parameters
            if ep["parameters"]:
                md_parts.append("**Parameters:**")
                md_parts.append("")
                md_parts.append("| Name | In | Type | Required | Description |")
                md_parts.append("|------|-----|------|----------|-------------|")
                for param in ep["parameters"]:
                    if isinstance(param, dict):
                        name = param.get("name", "")
                        loc = param.get("in", "")
                        required = "✅" if param.get("required", False) else ""
                        schema = param.get("schema", {})
                        ptype = schema.get("type", "")
                        if "enum" in schema:
                            ptype += f" (enum: {', '.join(str(e) for e in schema['enum'])})"
                        desc = param.get("description", "")
                        md_parts.append(f"| `{name}` | {loc} | {ptype} | {required} | {desc} |")
                md_parts.append("")

            # Request Body
            if ep["requestBody"]:
                rb = ep["requestBody"]
                content = rb.get("content", {})
                for ct, media in content.items():
                    md_parts.append(f"**Request Body** (`{ct}`):")
                    md_parts.append("")
                    body_schema = media.get("schema", {})
                    write_schema_ref(md_parts, body_schema, schemas)
                    md_parts.append("")

            # Responses
            if ep["responses"]:
                md_parts.append("**Responses:**")
                md_parts.append("")
                for status_code, resp_detail in ep["responses"].items():
                    desc = resp_detail.get("description", "")
                    md_parts.append(f"- **{status_code}**: {desc}")
                    resp_content = resp_detail.get("content", {})
                    for ct, media in resp_content.items():
                        resp_schema = media.get("schema", {})
                        if "$ref" in resp_schema:
                            ref_name = resp_schema["$ref"].split("/")[-1]
                            md_parts.append(f"  - Schema: [`{ref_name}`](#{ref_name.lower().replace('_', '-')})")
                        elif resp_schema.get("type") == "array" and "$ref" in resp_schema.get("items", {}):
                            ref_name = resp_schema["items"]["$ref"].split("/")[-1]
                            md_parts.append(f"  - Schema: array of [`{ref_name}`](#{ref_name.lower().replace('_', '-')})")
                        elif resp_schema:
                            md_parts.append(f"  - Schema: `{json.dumps(resp_schema)}`")
                md_parts.append("")

            md_parts.append("---")
            md_parts.append("")

    # Schemas / Data Models
    if schemas:
        md_parts.append("## Data Models (Schemas)")
        md_parts.append("")
        for schema_name, schema in sorted(schemas.items()):
            md_parts.append(f"### {schema_name}")
            md_parts.append("")
            if schema.get("description"):
                md_parts.append(schema["description"])
                md_parts.append("")
            if schema.get("type"):
                md_parts.append(f"**Type:** {schema['type']}")
                md_parts.append("")
            if schema.get("enum"):
                md_parts.append(f"**Enum values:** {', '.join(str(e) for e in schema['enum'])}")
                md_parts.append("")
            props = schema.get("properties", {})
            required_fields = set(schema.get("required", []))
            if props:
                md_parts.append("| Property | Type | Required | Description |")
                md_parts.append("|----------|------|----------|-------------|")
                for prop_name, prop in props.items():
                    req = "✅" if prop_name in required_fields else ""
                    ptype = prop.get("type", "")
                    if "$ref" in prop:
                        ptype = prop["$ref"].split("/")[-1]
                    elif prop.get("type") == "array" and "$ref" in prop.get("items", {}):
                        ptype = f"array of {prop['items']['$ref'].split('/')[-1]}"
                    elif prop.get("type") == "array" and prop.get("items", {}).get("type"):
                        ptype = f"array of {prop['items']['type']}"
                    if "enum" in prop:
                        ptype += f" (enum: {', '.join(str(e) for e in prop['enum'])})"
                    if "format" in prop:
                        ptype += f" ({prop['format']})"
                    desc = prop.get("description", "")
                    md_parts.append(f"| `{prop_name}` | {ptype} | {req} | {desc} |")
                md_parts.append("")
            # allOf composition
            if "allOf" in schema:
                md_parts.append("**Composed of:**")
                md_parts.append("")
                for sub in schema["allOf"]:
                    if "$ref" in sub:
                        ref_name = sub["$ref"].split("/")[-1]
                        md_parts.append(f"- [`{ref_name}`](#{ref_name.lower().replace('_', '-')})")
                md_parts.append("")
            md_parts.append("---")
            md_parts.append("")

    content = "\n".join(md_parts)
    structured_path = OUTPUT_DIR / "api-reference-openapi.md"
    structured_path.write_text(content, encoding="utf-8")
    print(f"\nSaved structured reference: {structured_path} ({len(content)} chars)")

    # Also overwrite api-reference.md with the better content
    api_ref_path = OUTPUT_DIR / "api-reference.md"
    api_ref_path.write_text(content, encoding="utf-8")
    print(f"Updated: {api_ref_path}")

    print(f"\nDone! Spec has {len(paths)} paths, {len(schemas)} schemas")


if __name__ == "__main__":
    download_and_convert()
