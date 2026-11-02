#!/usr/bin/env python3
"""Build discovery/data.json for the Discovery Report.

  python3 scripts/build_discovery.py            # fetch live feeds, merge curated data
  python3 scripts/build_discovery.py --offline  # skip the network, use the seed snapshot

What it does
  1. Reads fashion and tech RSS/Atom feeds (plus the Hacker News front page).
  2. Geotags each headline against a small gazetteer (cities, countries, brand HQs).
     If nothing matches, the pin falls back to the outlet's home city and is labelled so.
  3. Clusters headlines that cover the same story. `signal` = number of independent
     outlets covering it. Nothing is invented: no outlets, no signal.
  4. Merges hand-maintained events/releases from discovery/curated.json.

Standard library only. A feed that fails is skipped and reported in data.json.
If every feed fails, the previous stories (or the curated seed) are kept.
"""
import argparse, datetime as dt, email.utils, html, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "discovery" / "curated.json"
OUT = ROOT / "discovery" / "data.json"
UA = "Mozilla/5.0 (compatible; DiscoveryReportBot/1.0; +https://cfg-jabba.github.io/discovery/)"
MAX_AGE_H = 96          # stories older than this are dropped
PER_DOMAIN = 14         # stories kept per domain
TIMEOUT = 20

NYC = (40.71, -74.01, "New York")
SF = (37.77, -122.42, "San Francisco")
LON = (51.51, -0.13, "London")
FEEDS = [
    # (domain, outlet, url, home city used only when a headline names no place)
    ("fashion", "Vogue", "https://www.vogue.com/feed/rss", NYC),
    ("fashion", "The Business of Fashion", "https://www.businessoffashion.com/arc/outboundfeeds/rss/", LON),
    ("fashion", "Hypebeast", "https://hypebeast.com/feed", (22.32, 114.17, "Hong Kong")),
    ("fashion", "Highsnobiety", "https://www.highsnobiety.com/feed/", (52.52, 13.40, "Berlin")),
    ("fashion", "Fashionista", "https://fashionista.com/.rss/full/", NYC),
    ("fashion", "Who What Wear", "https://www.whowhatwear.com/rss", NYC),
    ("tech", "The Verge", "https://www.theverge.com/rss/index.xml", NYC),
    ("tech", "TechCrunch", "https://techcrunch.com/feed/", SF),
    ("tech", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", NYC),
    ("tech", "Wired", "https://www.wired.com/feed/rss", SF),
    ("tech", "Engadget", "https://www.engadget.com/rss.xml", NYC),
]
HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{}.json"
HN_HOME = (37.39, -122.08, "Mountain View")

# (pattern, lat, lon, place). Cities and countries, plus companies/brands by HQ.
# Explicit places outrank brands: "Apple Intelligence in China" pins to China, not Cupertino.
_RAW = [
    (r"\bparis\b|\bfrench\b|\bfrance\b|\bchanel\b|\bdior\b|\blouis vuitton\b|\blvmh\b|\bhermès\b|\bhermes\b|\bkering\b|\bsaint laurent\b|\bbalenciaga\b|\bceline\b", 48.86, 2.35, "Paris"),
    (r"\bmilan\b|\bitaly\b|\bitalian\b|\bprada\b|\bgucci\b|\bversace\b|\barmani\b|\bmoncler\b|\bbottega\b|\bfendi\b", 45.46, 9.19, "Milan"),
    (r"\blondon\b|\bbritain\b|\bbritish\b|\buk\b|\bburberry\b|\bstella mccartney\b|\bdeepmind\b|\barm holdings\b", 51.51, -0.13, "London"),
    (r"\bnew york\b|\bnyc\b|\bmanhattan\b|\bralph lauren\b|\btapestry\b|\bcalvin klein\b|\bmet gala\b|\bwall street\b", 40.71, -74.01, "New York"),
    (r"\blos angeles\b|\bhollywood\b|\bbeverly hills\b|\bnetflix\b|\bspacex\b|\btesla\b", 34.05, -118.24, "Los Angeles"),
    (r"\bsan francisco\b|\bbay area\b|\bopenai\b|\banthropic\b|\bstripe\b|\bwaymo\b|\bsalesforce\b|\buber\b", 37.77, -122.42, "San Francisco"),
    (r"\bsilicon valley\b|\bcupertino\b|\bapple\b|\bgoogle\b|\balphabet\b|\bmeta platforms\b|\bnvidia\b|\bintel\b|\bamd\b|\bmountain view\b|\bsanta clara\b", 37.33, -122.03, "Silicon Valley"),
    (r"\bseattle\b|\bredmond\b|\bmicrosoft\b|\bamazon\b|\baws\b|\bnike\b|\bportland\b", 47.61, -122.33, "Seattle"),
    (r"\blas vegas\b|\bces\b", 36.17, -115.14, "Las Vegas"),
    (r"\bwashington\b|\bwhite house\b|\bcongress\b|\bpentagon\b|\bfcc\b|\bftc\b", 38.91, -77.04, "Washington, D.C."),
    (r"\bcanada\b|\btoronto\b|\bmontreal\b|\bshopify\b", 43.65, -79.38, "Toronto"),
    (r"\bmexico\b", 19.43, -99.13, "Mexico City"),
    (r"\bbrazil\b|\bsão paulo\b|\bsao paulo\b|\brio\b", -23.55, -46.63, "São Paulo"),
    (r"\bargentina\b|\bbuenos aires\b", -34.60, -58.38, "Buenos Aires"),
    (r"\bberlin\b|\bgerman\b|\bgermany\b|\bmunich\b|\bsap\b|\badidas\b|\bpuma\b|\bhugo boss\b", 52.52, 13.40, "Berlin"),
    (r"\bcopenhagen\b|\bdenmark\b|\bdanish\b|\bganni\b|\bnovo\b", 55.68, 12.57, "Copenhagen"),
    (r"\bstockholm\b|\bsweden\b|\bswedish\b|\bh&m\b|\bspotify\b|\bklarna\b", 59.33, 18.07, "Stockholm"),
    (r"\bhelsinki\b|\bfinland\b|\bnokia\b", 60.17, 24.94, "Helsinki"),
    (r"\bamsterdam\b|\bnetherlands\b|\bdutch\b|\basml\b", 52.37, 4.90, "Amsterdam"),
    (r"\bzurich\b|\bswiss\b|\bswitzerland\b|\bgeneva\b|\bon running\b|\bhublot\b|\bcartier\b|\brichemont\b", 47.37, 8.54, "Zurich"),
    (r"\bmadrid\b|\bspain\b|\bspanish\b|\bbarcelona\b|\binditex\b|\bzara\b|\bmwc\b", 40.42, -3.70, "Madrid"),
    (r"\blisbon\b|\bportugal\b|\bweb summit\b", 38.72, -9.14, "Lisbon"),
    (r"\bdublin\b|\bireland\b", 53.35, -6.26, "Dublin"),
    (r"\bkyiv\b|\bukraine\b", 50.45, 30.52, "Kyiv"),
    (r"\bmoscow\b|\brussia\b|\brussian\b", 55.76, 37.62, "Moscow"),
    (r"\bistanbul\b|\bturkey\b|\bturkish\b", 41.01, 28.98, "Istanbul"),
    (r"\bdubai\b|\buae\b|\bemirates\b|\babu dhabi\b", 25.20, 55.27, "Dubai"),
    (r"\briyadh\b|\bsaudi\b", 24.71, 46.68, "Riyadh"),
    (r"\btel aviv\b|\bisrael\b|\bisraeli\b", 32.09, 34.78, "Tel Aviv"),
    (r"\bcairo\b|\begypt\b", 30.04, 31.24, "Cairo"),
    (r"\blagos\b|\bnigeria\b|\bnigerian\b", 6.52, 3.38, "Lagos"),
    (r"\bnairobi\b|\bkenya\b", -1.29, 36.82, "Nairobi"),
    (r"\bjohannesburg\b|\bcape town\b|\bsouth africa\b", -26.20, 28.05, "Johannesburg"),
    (r"\bmumbai\b|\bindia\b|\bindian\b|\btata\b|\btrent\b|\breliance\b|\binfosys\b", 19.08, 72.88, "Mumbai"),
    (r"\bdelhi\b|\bbengaluru\b|\bbangalore\b", 28.61, 77.21, "New Delhi"),
    (r"\bbeijing\b|\bchina\b|\bchinese\b|\balibaba\b|\bbaidu\b|\bbytedance\b|\btencent\b|\bxiaomi\b|\bhuawei\b|\bmao\b", 39.90, 116.41, "Beijing"),
    (r"\bshanghai\b|\bweibo\b|\bshein\b|\bagibot\b|\bunitree\b", 31.23, 121.47, "Shanghai"),
    (r"\bshenzhen\b|\bdji\b|\bbyd\b|\bfoxconn\b", 22.54, 114.06, "Shenzhen"),
    (r"\bhong kong\b", 22.32, 114.17, "Hong Kong"),
    (r"\btaipei\b|\btaiwan\b|\btsmc\b|\basus\b|\bacer\b|\bmediatek\b|\bhsinchu\b", 25.03, 121.57, "Taipei"),
    (r"\btokyo\b|\bjapan\b|\bjapanese\b|\bsony\b|\bnintendo\b|\buniqlo\b|\bcomme des\b|\bissey\b|\btoyota\b|\bsoftbank\b", 35.68, 139.69, "Tokyo"),
    (r"\bseoul\b|\bkorea\b|\bkorean\b|\bsamsung\b|\blg\b|\bhyundai\b|\bk-pop\b|\bgentle monster\b", 37.57, 126.98, "Seoul"),
    (r"\bsingapore\b", 1.35, 103.82, "Singapore"),
    (r"\bjakarta\b|\bindonesia\b", -6.21, 106.85, "Jakarta"),
    (r"\bmanila\b|\bphilippines\b|\bfilipino\b", 14.60, 120.98, "Manila"),
    (r"\bbangkok\b|\bthailand\b|\bthai\b", 13.76, 100.50, "Bangkok"),
    (r"\bsydney\b|\baustralia\b|\baustralian\b|\bmelbourne\b", -33.87, 151.21, "Sydney"),
]



BRANDS = set("""dior|chanel|louis vuitton|lvmh|hermès|hermes|kering|saint laurent|balenciaga|celine|prada|gucci|versace|armani
moncler|bottega|fendi|burberry|stella mccartney|deepmind|arm holdings|ralph lauren|tapestry|calvin klein|netflix|spacex
tesla|openai|anthropic|stripe|waymo|salesforce|uber|apple|google|alphabet|meta platforms|nvidia|intel|amd|microsoft|amazon
aws|nike|shopify|sap|adidas|puma|hugo boss|ganni|novo|h&m|spotify|klarna|nokia|asml|on running|hublot|cartier|richemont
inditex|zara|tata|trent|reliance|infosys|alibaba|baidu|bytedance|tencent|xiaomi|huawei|mao|weibo|shein|agibot|unitree|dji
byd|foxconn|tsmc|asus|acer|mediatek|sony|nintendo|uniqlo|comme des|issey|toyota|softbank|samsung|lg|hyundai|gentle monster
ces|mwc|web summit|fcc|ftc|white house|congress|pentagon|met gala|wall street|k-pop|hollywood""".replace("\n", "|").split("|"))


def _split(pattern):
    places, brands = [], []
    for alt in pattern.split("|"):
        word = re.sub(r"\\b", "", alt).replace("\\.", ".").lower()
        (brands if word in BRANDS else places).append(alt)
    comp = lambda alts: re.compile("|".join(alts), re.I) if alts else None
    return comp(places), comp(brands)


GAZ = [(*_split(p), la, lo, n) for p, la, lo, n in _RAW]


def fetch(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc)


def iso_utc(d):
    return d.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_feed(xml_bytes):
    """Yield dicts {title, link, summary, published} from RSS 2.0 or Atom."""
    root = ET.fromstring(xml_bytes)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for it in root.iter("item"):
        yield {
            "title": strip_html(it.findtext("title")),
            "link": (it.findtext("link") or "").strip(),
            "summary": strip_html(it.findtext("description")),
            "published": parse_date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date")),
        }
    for e in root.iterfind("a:entry", ns):
        link = e.find("a:link[@rel='alternate']", ns)
        if link is None:
            link = e.find("a:link", ns)
        yield {
            "title": strip_html(e.findtext("a:title", namespaces=ns)),
            "link": (link.get("href") if link is not None else "") or "",
            "summary": strip_html(e.findtext("a:summary", namespaces=ns) or e.findtext("a:content", namespaces=ns)),
            "published": parse_date(e.findtext("a:published", namespaces=ns) or e.findtext("a:updated", namespaces=ns)),
        }


def geotag(title, summary, home):
    """Pin priority: a place named in the title, in the summary, a brand HQ in the title, in the
    summary, and finally the outlet's home city (labelled 'source')."""
    for use_brands in (False, True):
        for text in (title, summary):
            best = None
            for places, brands, la, lo, name in GAZ:
                rx = brands if use_brands else places
                m = rx.search(text or "") if rx else None
                if m and (best is None or m.start() < best[0]):
                    best = (m.start(), la, lo, name)
            if best:
                return best[1], best[2], best[3], "hq" if use_brands else "mentioned"
    la, lo, name = home
    return la, lo, name, "source"


STOP = set("""the and for with that this from have has had are was were will its into over after before more than
 about your you our their they them his her who what when how why new says said say out not but can may could would
 should just also been being amid via per get gets got off all one two now up out""".split())


def tokens(text):
    return {w for w in re.findall(r"[a-z0-9][a-z0-9'’-]{2,}", text.lower()) if w not in STOP}


def similar(a, b):
    if not a or not b:
        return False
    inter, ratio = len(a & b), len(a & b) / len(a | b)
    return (inter >= 3 and ratio >= 0.25) or (inter >= 2 and ratio >= 0.5)


def cluster(items):
    clusters = []
    for it in sorted(items, key=lambda x: x["published"], reverse=True):
        toks = tokens(it["title"])
        for c in clusters:
            if c["domain"] == it["domain"] and similar(toks, c["tokens"]) and all(m["outlet"] != it["outlet"] for m in c["members"]):
                c["members"].append(it)
                break
        else:
            clusters.append({"domain": it["domain"], "tokens": toks, "members": [it]})
    return clusters


def collect(now):
    items, ok, failed = [], [], []
    for domain, outlet, url, home in FEEDS:
        try:
            for e in parse_feed(fetch(url)):
                if not e["title"] or not e["link"].startswith("http") or not e["published"]:
                    continue
                if (now - e["published"]).total_seconds() / 3600 > MAX_AGE_H:
                    continue
                e.update(domain=domain, outlet=outlet, home=home, hn=0)
                items.append(e)
            ok.append(outlet)
        except Exception as exc:  # noqa: BLE001 - a bad feed must never stop the build
            failed.append(f"{outlet}: {type(exc).__name__}")
    try:
        ids = json.loads(fetch(HN_TOP))[:30]
        for i in ids:
            s = json.loads(fetch(HN_ITEM.format(i), 10) or b"{}")
            if not s or s.get("type") != "story" or not s.get("title"):
                continue
            pub = dt.datetime.fromtimestamp(s["time"], dt.timezone.utc)
            if (now - pub).total_seconds() / 3600 > MAX_AGE_H:
                continue
            link = s.get("url") or f"https://news.ycombinator.com/item?id={i}"
            items.append(dict(title=strip_html(s["title"]), link=link, summary="", published=pub, domain="tech",
                              outlet="Hacker News", home=HN_HOME, hn=int(s.get("score", 0))))
        ok.append("Hacker News")
    except Exception as exc:  # noqa: BLE001
        failed.append(f"Hacker News: {type(exc).__name__}")
    return items, ok, failed


def build_stories(items, now):
    stories = []
    for c in cluster(items):
        ms = sorted(c["members"], key=lambda m: m["published"], reverse=True)
        lead = max(ms, key=lambda m: len(m["summary"])) if any(m["summary"] for m in ms) else ms[0]
        lat, lon, place, geo = geotag(ms[0]["title"], lead["summary"], ms[0]["home"])
        signal = len(ms)
        hn = max(m["hn"] for m in ms)
        age_h = (now - ms[0]["published"]).total_seconds() / 3600
        rank = signal * 10 + min(hn / 100, 8) - age_h / 8
        # The id comes from the first headline in the cluster, so it stays put as more outlets join in.
        slug = re.sub(r"[^a-z0-9]+", "-", ms[-1]["title"].lower()).strip("-")[:48]
        summary = lead["summary"]
        summary = (summary[:237].rsplit(" ", 1)[0] + "…") if len(summary) > 240 else summary
        stories.append({
            "id": f"{c['domain']}-{slug}", "kind": "story", "domain": c["domain"], "title": ms[0]["title"],
            "summary": summary, "lat": lat, "lon": lon, "place": place, "geo": geo,
            "published": ms[0]["published"].date().isoformat(), "published_at": iso_utc(ms[0]["published"]),
            "signal": signal, "hn": hn or None,
            "confidence": "high" if signal >= 3 else "medium" if signal == 2 else "low",
            "sources": [{"name": m["outlet"], "url": m["link"], "at": iso_utc(m["published"])} for m in ms], "_rank": rank,
        })
    out = []
    for domain in ("fashion", "tech"):
        top = sorted((s for s in stories if s["domain"] == domain), key=lambda s: s["_rank"], reverse=True)[:PER_DOMAIN]
        out += top
    for s in out:
        s.pop("_rank")
    return out


def load_json(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="skip network; use seed/previous stories")
    ap.add_argument("--now", help="override 'now' (ISO date), for tests")
    args = ap.parse_args()

    now = dt.datetime.fromisoformat(args.now).replace(tzinfo=dt.timezone.utc) if args.now else dt.datetime.now(dt.timezone.utc)
    cur = load_json(CURATED)
    if not cur:
        sys.exit("discovery/curated.json is missing or invalid")
    prev = load_json(OUT) or {}

    stories, ok, failed, mode, note = [], [], [], "snapshot", cur.get("snapshot_note", "")
    if not args.offline:
        items, ok, failed = collect(now)
        stories = build_stories(items, now)
    # Require some corroboration of life: at least 5 stories from at least 2 outlets, else keep the last good set.
    if len(stories) >= 5 and len(ok) >= 2:
        mode, note = "live", f"Compiled automatically from {len(ok)} outlets. Events and releases are hand-curated."
    else:
        prev_stories = [i for i in prev.get("items", []) if i.get("kind") == "story"]
        stories = prev_stories or [dict(s, kind="story") for s in cur["seed_stories"]]
        if prev.get("mode") == "live" and prev_stories:
            mode, note = "live", prev.get("note", "") + " (Last build could not reach the feeds; showing the previous stories.)"
        failed = failed or ([] if args.offline else ["no live stories"])

    today = now.date().isoformat()
    events = [dict(e, kind="event") for e in cur["events"] if e["end"] >= today]
    releases = [dict(r, kind="release") for r in cur["releases"] if r["end"] >= today]
    out = {
        "generated": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "mode": mode, "note": note, "feeds_ok": ok, "feeds_failed": failed,
        "items": stories + events + releases,
    }
    # `generated` means "the content last changed": if only the clock moved, keep the file as it was.
    if prev and {k: v for k, v in prev.items() if k != "generated"} == {k: v for k, v in out.items() if k != "generated"}:
        print("no change in content; data.json left as it was")
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    n ={k: sum(1 for i in out["items"] if i["kind"] == k) for k in ("story", "event", "release")}
    print(f"wrote {OUT.relative_to(ROOT)}: mode={mode} {n} ok={len(ok)} failed={len(failed)}")


if __name__ == "__main__":
    main()
