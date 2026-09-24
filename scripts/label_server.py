#!/usr/bin/env python3
"""Local labelling server for the T3 bar-detector dataset.

Serves the frames + a canvas UI and writes edits straight to disk (no
download/upload dance). Labels a smart subset by default: a few evenly-spaced
frames per clip (a detector needs ~5-10 labelled frames per clip, not all).

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/label_server.py
    # then open http://localhost:8765

Hotkeys:  P=plate  B=barbell  E=person  Del=delete  C=copy previous frame
          N / ->=next  <- =prev  S=save  Space=toggle auto-advance

Edits persist to ``<data>/labels.corrected.jsonl`` on every change.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from bar_labels import clamp_box

HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Bar labeler</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#0b1220;color:#e2e8f0;font:13px/1.4 system-ui,sans-serif}
 header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#111a2e;position:sticky;top:0;z-index:2}
 button{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 10px;cursor:pointer}
 button:hover{background:#273449} button.on{background:#0369a1;border-color:#0ea5e9}
 #wrap{padding:12px;display:flex;justify-content:center}
 canvas{max-width:100%;height:auto;border:1px solid #334155;border-radius:8px;cursor:crosshair;touch-action:none}
 .muted{color:#94a3b8} kbd{background:#1e293b;border:1px solid #334155;border-radius:4px;padding:0 4px}
 .dot{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:4px}
</style></head>
<body>
<header>
  <button id="prev">&larr; Prev</button>
  <span id="counter" class="muted"></span>
  <button id="next">Next &rarr;</button>
  <span style="width:10px"></span>
  <button data-label="plate" class="on" style="border-color:#facc15">Plate (P)</button>
  <button data-label="barbell" style="border-color:#22c55e">Barbell (B)</button>
  <button data-label="person" style="border-color:#38bdf8">Person (E)</button>
  <button id="del">Delete</button>
  <button id="copy">Copy prev (C)</button>
  <button id="skip">Skip</button>
  <span style="width:10px"></span>
  <button id="auto" class="on">Auto-advance</button>
  <span id="status" class="muted"></span>
</header>
<div id="wrap"><canvas id="c"></canvas></div>
<p class="muted" style="padding:0 12px">Drag on empty space to add a <b>plate</b> box &middot; drag a box to move &middot; corner to resize &middot; <kbd>P</kbd>/<kbd>B</kbd>/<kbd>E</kbd> set label &middot; <kbd>Del</kbd> remove &middot; <kbd>N</kbd>/<kbd>&rarr;</kbd> next</p>
<script>
const COLORS={plate:'#facc15',barbell:'#22c55e',person:'#38bdf8'};
const c=document.getElementById('c'),ctx=c.getContext('2d'),img=new Image();
let st=null,rec=null,sel=-1,drag=null,curLabel='plate',auto=true;
const $=id=>document.getElementById(id);
function toPx(b){const w=c.width,h=c.height;return{x1:(b.x-b.w/2)*w,y1:(b.y-b.h/2)*h,x2:(b.x+b.w/2)*w,y2:(b.y+b.h/2)*h};}
function normRect(x1,y1,x2,y2){const w=c.width,h=c.height;const ax=Math.min(x1,x2),ay=Math.min(y1,y2),bx=Math.max(x1,x2),by=Math.max(y1,y2);return{x:(ax+bx)/2/w,y:(ay+by)/2/h,w:(bx-ax)/w,h:(by-ay)/h};}
function pos(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)};}
function hit(p){const bs=rec.boxes;for(let k=bs.length-1;k>=0;k--){const r=toPx(bs[k]);if(p.x>=r.x1&&p.x<=r.x2&&p.y>=r.y1&&p.y<=r.y2)return k;}return -1;}
function nearHandle(p){if(sel<0)return false;const r=toPx(rec.boxes[sel]);return Math.abs(p.x-r.x2)<16&&Math.abs(p.y-r.y2)<16;}
function draw(){ctx.clearRect(0,0,c.width,c.height);if(img.complete)ctx.drawImage(img,0,0,c.width,c.height);
  rec.boxes.forEach((b,k)=>{const r=toPx(b);ctx.lineWidth=k===sel?4:2;ctx.strokeStyle=COLORS[b.label]||'#fff';ctx.strokeRect(r.x1,r.y1,r.x2-r.x1,r.y2-r.y1);
   ctx.fillStyle=COLORS[b.label]||'#fff';ctx.fillText(b.label,r.x1+4,r.y1+13);if(k===sel)ctx.fillRect(r.x2-5,r.y2-5,10,10);});}
function upd(){const i=st.work.indexOf(st.i);$('counter').textContent=`${i+1}/${st.work.length}  ${rec.image}${rec.done?'  \u2713':''}`;
  $('prev').disabled=st.i<=0;$('next').disabled=st.i>=st.records.length-1;}
function go(d){const p=st.work.indexOf(st.i);const base=p<0?0:p;const np=Math.max(0,Math.min(st.work.length-1,base+d));show(st.work[np]);}
function show(i){st.i=Math.max(0,Math.min(st.records.length-1,i));rec=st.records[st.i];sel=-1;
  img.onload=()=>{c.width=img.naturalWidth;c.height=img.naturalHeight;c.style.width=Math.min(1280,img.naturalWidth)+'px';draw();};
  img.src='/frames/'+rec.image;upd();}
function save(){fetch('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:st.i,boxes:rec.boxes,done:rec.done})})
  .then(r=>r.json()).then(j=>{$('status').textContent='saved '+j.saved;setTimeout(()=>$('status').textContent='',1500);});}
function next(skip){if(auto||skip)go(1);else upd();}
c.addEventListener('pointerdown',e=>{const p=pos(e);if(nearHandle(p)){drag={m:'resize'};return;}
  const k=hit(p);if(k>=0){sel=k;const r=toPx(rec.boxes[k]);drag={m:'move',ox:p.x-(r.x1+r.x2)/2,oy:p.y-(r.y1+r.y2)/2};}
  else{rec.boxes.push({label:curLabel,source:'human',x:0,y:0,w:0,h:0});sel=rec.boxes.length-1;drag={m:'new',a:p};}draw();});
c.addEventListener('pointermove',e=>{if(!drag)return;const p=pos(e),b=rec.boxes[sel];
  if(drag.m==='move'){const cx=p.x-drag.ox,cy=p.y-drag.oy;Object.assign(b,normRect(cx-b.w*c.width/2,cy-b.h*c.height/2,cx+b.w*c.width/2,cy+b.h*c.height/2));}
  else if(drag.m==='resize'){const r=toPx(b);Object.assign(b,normRect(r.x1,r.y1,p.x,p.y));}
  else{Object.assign(b,normRect(drag.a.x,drag.a.y,p.x,p.y));}b.source='human';draw();});
window.addEventListener('pointerup',()=>{if(drag&&sel>=0){const b=rec.boxes[sel];if(b.w<0.01||b.h<0.01)rec.boxes.splice(sel,1);}drag=null;draw();if(!drag)save();});
document.addEventListener('keydown',e=>{const k=e.key;
  if(k==='ArrowRight'||k==='n'){e.preventDefault();go(1);}
  else if(k==='ArrowLeft'){e.preventDefault();go(-1);}
  else if(k==='Delete'||k==='Backspace'){if(sel>=0){rec.boxes.splice(sel,1);sel=-1;draw();save();}e.preventDefault();}
  else if(k==='p'){curLabel='plate';setActive();}
  else if(k==='b'){curLabel='barbell';setActive();}
  else if(k==='e'){curLabel='person';setActive();}
  else if(k==='s'){save();}
  else if(k==='c'){copyPrev();}
  else if(k===' '){auto=!auto;$('auto').classList.toggle('on',auto);e.preventDefault();}});
document.querySelectorAll('button[data-label]').forEach(b=>b.onclick=()=>{curLabel=b.dataset.label;if(sel>=0){rec.boxes[sel].label=curLabel;rec.boxes[sel].source='human';draw();save();}setActive();});
function setActive(){document.querySelectorAll('button[data-label]').forEach(b=>b.classList.toggle('on',b.dataset.label===curLabel));}
function copyPrev(){const p=st.records[st.i-1];if(!p)return;rec.boxes=p.boxes.map(b=>({...b,source:'human'}));draw();save();}
$('prev').onclick=()=>go(-1);$('next').onclick=()=>go(1);$('del').onclick=()=>{if(sel>=0){rec.boxes.splice(sel,1);sel=-1;draw();save();}};
$('copy').onclick=copyPrev;$('skip').onclick=()=>{rec.done=true;save();go(1);};
$('auto').onclick=()=>{auto=!auto;$('auto').classList.toggle('on',auto);};
fetch('/api/state').then(r=>r.json()).then(s=>{st=s;show(s.i);});
</script></body></html>"""


def _clip_of(image: str) -> str:
    stem = Path(image).stem
    return re.sub(r"_\d+$", "", stem)


def build_worklist(records: list, per_clip: int) -> list[int]:
    """Evenly-spaced frame indices per clip (a detector needs a few per clip)."""
    by_clip: dict[str, list[int]] = {}
    for i, r in enumerate(records):
        by_clip.setdefault(_clip_of(r["image"]), []).append(i)
    work: list[int] = []
    for idxs in by_clip.values():
        n = min(per_clip, len(idxs))
        step = max(1, len(idxs) // n)
        work.extend(idxs[::step][:n])
    return sorted(work)


def make_handler(data: Path, out_path: Path, state: dict):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _send(self, code, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                payload = {
                    "records": state["records"],
                    "work": state["work"],
                    "i": state["i"],
                }
                self._send(200, json.dumps(payload).encode(), "application/json")
            elif self.path.startswith("/frames/"):
                rel = self.path[len("/frames/"):]
                target = (data / rel).resolve()
                if not str(target).startswith(str(data.resolve())) or not target.exists():
                    self._send(404, b"not found", "text/plain")
                    return
                self._send(200, target.read_bytes(), "image/jpeg")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/update":
                i = int(body.get("index", -1))
                if 0 <= i < len(state["records"]):
                    boxes = [clamp_box(b) for b in body.get("boxes", [])]
                    state["records"][i]["boxes"] = boxes
                    state["records"][i]["done"] = bool(body.get("done"))
                    out_path.write_text(
                        "\n".join(json.dumps(r, separators=(",", ":"))
                                  for r in state["records"]) + "\n",
                        encoding="utf-8")
                self._send(200, json.dumps({"saved": len(state["records"])}).encode(),
                           "application/json")
            else:
                self._send(404, b"not found", "text/plain")

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=REPO_ROOT / "labels" / "bars")
    ap.add_argument("--labels", type=Path, default=None,
                    help="input JSONL (default <data>/labels.jsonl)")
    ap.add_argument("--out", type=Path, default=None,
                    help="output JSONL (default <data>/labels.corrected.jsonl)")
    ap.add_argument("--per-clip", type=int, default=8,
                    help="frames to label per clip (default 8)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    labels_path = args.labels or (args.data / "labels.jsonl")
    out_path = args.out or (args.data / "labels.corrected.jsonl")
    records = [json.loads(l) for l in labels_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    work = build_worklist(records, args.per_clip)
    state = {"records": records, "work": work, "i": work[0] if work else 0}

    url = f"http://localhost:{args.port}"
    print(f"{len(records)} records; {len(work)} to label ({args.per_clip}/clip)")
    print(f"serving {args.data} -> {url}  (edits -> {out_path})")
    if not args.no_browser:
        webbrowser.open(url)

    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                 make_handler(args.data, out_path, state))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
