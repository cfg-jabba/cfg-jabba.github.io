#!/usr/bin/env python3
"""Build discovery/data.json: a global news scrape, clustered by story.

  python3 scripts/build_discovery.py            # fetch live sources, merge curated data
  python3 scripts/build_discovery.py --offline  # skip the network, keep the previous stories

Sources (all public, no keys, nothing paid)
  1. GDELT 2.0 Global Knowledge Graph, refreshed every 15 minutes: articles from thousands of
     outlets in ~100 languages, each already tagged with places, themes, people, organisations
     and tone. English files for the last few hours plus the machine-translated files.
  2. About fifty named RSS/Atom feeds across world, business, tech, science, sport, culture
     and fashion, spread over every region.
  3. The Hacker News front page.
  4. Hand-curated upcoming events and releases (discovery/curated.json).

How a story is made
  Every article, whatever its source, is clustered with the others that cover the same story
  (same language, shared headline terms). `signal` is the number of independent outlets in the
  cluster. A story needs two outlets, or one of our named feeds. Nothing is invented: no outlets,
  no signal. The pin is the place most of the coverage is about, and the page says how it was found.

Standard library only. A source that fails is skipped and reported in data.json.
If everything fails, the previous stories (or the curated seed) are kept.
GDELT is free to use with attribution (https://www.gdeltproject.org/); the page credits it.
"""
import argparse, collections, datetime as dt, email.utils, html, io, json, math, re, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "discovery" / "curated.json"
OUT = ROOT / "discovery" / "data.json"
UA = "Mozilla/5.0 (compatible; AtlasFeedBot/2.0; +https://cfg-jabba.github.io/discovery/)"
MAX_AGE_H = 72          # feed items older than this are dropped
MAX_STORIES = 500       # stories kept in total
PER_PLACE = 14          # stories kept per pin location, so no city swallows the globe
TIMEOUT = 25
GKG_EN_FILES = 12       # 15-minute GDELT files: 12 = the last 3 hours of English-language coverage
GKG_TR_FILES = 6        # ... and the last 1.5 hours of machine-translated coverage
GDELT = "http://data.gdeltproject.org/gdeltv2/"

NYC = (40.71, -74.01, "New York")
SF = (37.77, -122.42, "San Francisco")
LON = (51.51, -0.13, "London")
DC = (38.91, -77.04, "Washington, D.C.")
PAR = (48.86, 2.35, "Paris")
BER = (52.52, 13.40, "Berlin")
BRU = (50.85, 4.35, "Brussels")
DOH = (25.29, 51.53, "Doha")
HK = (22.32, 114.17, "Hong Kong")
TYO = (35.68, 139.69, "Tokyo")
SIN = (1.35, 103.82, "Singapore")
SYD = (-33.87, 151.21, "Sydney")
MUM = (19.08, 72.88, "Mumbai")
DEL = (28.61, 77.21, "New Delhi")
JER = (31.77, 35.21, "Jerusalem")
KHI = (24.86, 67.00, "Karachi")
KYV = (50.45, 30.52, "Kyiv")
MOW = (55.76, 37.62, "Moscow")
BKK = (13.76, 100.50, "Bangkok")
JNB = (-26.20, 28.05, "Johannesburg")
LOS = (6.52, 3.38, "Lagos")
BUE = (-34.60, -58.38, "Buenos Aires")
MVD = (-34.90, -56.16, "Montevideo")
LYS = (45.76, 4.84, "Lyon")
MAD = (40.42, -3.70, "Madrid")
TPE = (25.03, 121.57, "Taipei")
DUB = (53.35, -6.26, "Dublin")

# (domain, outlet, url, home). domain None = decide per headline. `home` is only used when a
# headline names no place.
FEEDS = [
    # world, general
    (None, "BBC News", "http://feeds.bbci.co.uk/news/world/rss.xml", LON),
    (None, "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", DOH),
    (None, "The Guardian", "https://www.theguardian.com/world/rss", LON),
    (None, "NPR", "https://feeds.npr.org/1001/rss.xml", DC),
    (None, "Deutsche Welle", "https://rss.dw.com/rdf/rss-en-all", BER),
    (None, "France 24", "https://www.france24.com/en/rss", PAR),
    (None, "Euronews", "https://www.euronews.com/rss?format=mrss", LYS),
    (None, "ABC Australia", "https://www.abc.net.au/news/feed/51120/rss.xml", SYD),
    (None, "CNA", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", SIN),
    (None, "The Straits Times", "https://www.straitstimes.com/news/world/rss.xml", SIN),
    (None, "The Times of India", "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", MUM),
    (None, "The Hindu", "https://www.thehindu.com/news/international/feeder/default.rss", (13.08, 80.27, "Chennai")),
    (None, "South China Morning Post", "https://www.scmp.com/rss/91/feed", HK),
    (None, "The Japan Times", "https://www.japantimes.co.jp/feed/", TYO),
    (None, "Africanews", "https://www.africanews.com/feed/rss", LYS),
    (None, "The Times of Israel", "https://www.timesofisrael.com/feed/", JER),
    (None, "Dawn", "https://www.dawn.com/feeds/home", KHI),
    (None, "MercoPress", "https://en.mercopress.com/rss", MVD),
    (None, "Politico Europe", "https://www.politico.eu/feed/", BRU),
    (None, "The Kyiv Independent", "https://kyivindependent.com/news-archive/rss/", KYV),
    (None, "The Moscow Times", "https://www.themoscowtimes.com/rss/news", MOW),
    (None, "Le Monde (English)", "https://www.lemonde.fr/en/rss/une.xml", PAR),
    (None, "El País (English)", "https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada", MAD),
    (None, "Bangkok Post", "https://www.bangkokpost.com/rss/data/topstories.xml", BKK),
    (None, "Daily Maverick", "https://www.dailymaverick.co.za/dmrss/", JNB),
    (None, "Premium Times", "https://www.premiumtimesng.com/feed", (9.06, 7.49, "Abuja")),
    (None, "Buenos Aires Times", "https://www.batimes.com.ar/feed", BUE),
    (None, "Taipei Times", "https://www.taipeitimes.com/xml/index.rss", TPE),
    (None, "Global Voices", "https://globalvoices.org/feed/", NYC),
    # business
    ("business", "BBC Business", "http://feeds.bbci.co.uk/news/business/rss.xml", LON),
    ("business", "The Guardian Business", "https://www.theguardian.com/uk/business/rss", LON),
    ("business", "CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", NYC),
    ("business", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", NYC),
    ("business", "Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar", TYO),
    ("business", "The Hindu BusinessLine", "https://www.thehindu.com/business/feeder/default.rss", (13.08, 80.27, "Chennai")),
    # science and health
    ("science", "NASA", "https://www.nasa.gov/rss/dyn/breaking_news.rss", DC),
    ("science", "New Scientist", "https://www.newscientist.com/feed/home/", LON),
    ("science", "ScienceDaily", "https://www.sciencedaily.com/rss/all.xml", (39.0, -77.1, "Rockville")),
    ("science", "Nature", "https://www.nature.com/nature.rss", LON),
    ("science", "Ars Technica Science", "https://feeds.arstechnica.com/arstechnica/science", NYC),
    # sport
    ("sport", "BBC Sport", "http://feeds.bbci.co.uk/sport/rss.xml", LON),
    ("sport", "ESPN", "https://www.espn.com/espn/rss/news", (41.76, -72.69, "Bristol, Connecticut")),
    ("sport", "Sky Sports", "https://www.skysports.com/rss/12040", LON),
    # culture and fashion
    ("culture", "Variety", "https://variety.com/feed/", (34.05, -118.24, "Los Angeles")),
    ("culture", "Rolling Stone", "https://www.rollingstone.com/feed/", NYC),
    ("culture", "Pitchfork", "https://pitchfork.com/feed/feed-news/rss", NYC),
    ("culture", "Dezeen", "https://www.dezeen.com/feed/", LON),
    ("fashion", "WWD", "https://wwd.com/feed/", NYC),
    ("fashion", "Vogue", "https://www.vogue.com/feed/rss", NYC),
    ("fashion", "The Business of Fashion", "https://www.businessoffashion.com/arc/outboundfeeds/rss/", LON),
    ("fashion", "Hypebeast", "https://hypebeast.com/feed", HK),
    ("fashion", "Highsnobiety", "https://www.highsnobiety.com/feed/", BER),
    ("fashion", "Fashionista", "https://fashionista.com/.rss/full/", NYC),
    ("fashion", "Who What Wear", "https://www.whowhatwear.com/rss", NYC),
    # tech
    ("tech", "The Verge", "https://www.theverge.com/rss/index.xml", NYC),
    ("tech", "TechCrunch", "https://techcrunch.com/feed/", SF),
    ("tech", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", NYC),
    ("tech", "Wired", "https://www.wired.com/feed/rss", SF),
    ("tech", "Wired UK", "https://www.wired.co.uk/feed/rss", LON),
    ("tech", "Engadget", "https://www.engadget.com/rss.xml", NYC),
    ("tech", "MIT Technology Review", "https://www.technologyreview.com/feed/", (42.36, -71.09, "Cambridge, Massachusetts")),
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



# ---------------------------------------------------------------- plumbing

def fetch(url, timeout=TIMEOUT, tries=2):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - the caller decides what a failure means
            last = exc
    raise last


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def iso_utc(d):
    return d.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc)


def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _text(el, *names):
    for c in el:
        if _local(c.tag) in names and (c.text or "").strip():
            return c.text
    return None


def parse_feed(xml_bytes):
    """Yield dicts {title, link, summary, published} from RSS 2.0, RSS 1.0 (RDF) or Atom."""
    root = ET.fromstring(xml_bytes)
    for el in root.iter():
        kind = _local(el.tag)
        if kind not in ("item", "entry"):
            continue
        link = ""
        for c in el:
            if _local(c.tag) == "link":
                if c.get("href") and c.get("rel", "alternate") == "alternate":
                    link = c.get("href"); break
                if (c.text or "").strip():
                    link = c.text.strip(); break
        yield {
            "title": strip_html(_text(el, "title")),
            "link": link.strip(),
            "summary": strip_html(_text(el, "description", "summary", "content")),
            "published": parse_date(_text(el, "pubDate", "date", "published", "updated")),
        }


# ---------------------------------------------------------------- where a story is

PLACES = {}   # lower-case place name -> (lat, lon, display); learned from GDELT's gazetteer each run
_CAP = re.compile(r"[A-Z][\w'’.-]*(?:\s+(?:of\s+|de\s+|la\s+|del\s+)?[A-Z][\w'’.-]*){0,2}")
AMBIG = {"jordan", "reading", "nice", "mobile", "orange", "jackson", "victoria", "santiago", "chad", "mark",
         "will", "grace", "hope", "bath", "march", "lima", "nova", "polo", "paris hilton", "cuba gooding"}


def place_from_text(text):
    for m in _CAP.finditer(text or ""):
        words = m.group(0).split()
        for n in range(len(words), 0, -1):
            for i in range(len(words) - n + 1):
                key = " ".join(words[i:i + n]).lower().strip(".'’-")
                if len(key) >= 4 and key not in AMBIG and key in PLACES:
                    return PLACES[key]
    return None


def geotag(title, summary, home):
    """Pin priority: a place GDELT knows named in the title, then our own list of places in the
    title, in the summary, a company's HQ, and finally the outlet's home city (labelled 'source')."""
    p = place_from_text(title)
    if p:
        return p[0], p[1], p[2], "mentioned"
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
    if home:
        return home[0], home[1], home[2], "source"
    return None


# ---------------------------------------------------------------- what a story is about

KEYWORDS = [
    ("fashion", r"\b(fashion|runway|couture|designer|sneakers?|handbags?|streetwear|menswear|womenswear)\b"),
    ("sport", r"\b(match|league|cup|goals?|coach|olympics?|nba|nfl|fifa|uefa|premier league|tennis|cricket|wicket|formula 1|grand prix|champions?|tournament|striker|innings|world series)\b"),
    ("science", r"\b(study|scientists?|researchers?|nasa|space|climate|vaccines?|virus|disease|species|fossil|asteroid|telescope|cancer|health|outbreak|earthquake|hurricane|wildfire|floods?|storm)\b"),
    ("tech", r"\b(ai|openai|chips?|software|apps?|startups?|cyber|hack(?:ers?|ed)?|smartphones?|iphone|android|robots?|data cent(?:re|er)s?|semiconductors?|cloud|quantum|crypto|bitcoin)\b"),
    ("business", r"\b(shares|stocks?|markets?|inflation|tariffs?|earnings|profits?|revenue|bank|economy|economic|investors?|merger|ipo|oil prices?|gdp|interest rates?|central bank)\b"),
    ("culture", r"\b(film|movie|album|singer|actor|actress|festival|box office|series|streaming|concert|tour|novel|museum|oscars?|grammys?)\b"),
]
KEYWORDS = [(d, re.compile(rx, re.I)) for d, rx in KEYWORDS]


def classify_text(title, default="world"):
    for d, rx in KEYWORDS:
        if rx.search(title):
            return d
    return default


THEME_DOMAINS = [
    ("sport", re.compile(r"^(SPORT|SOC_SPORT|OLYMP)")),
    ("business", re.compile(r"^(ECON_|TAX_ECON|BUSINESS|BANKING|INFLATION|WB_\d+_(?:ECONOMIC|TRADE|FINANC|BANK))")),
    ("tech", re.compile(r"^(CYBER|TECH|INTERNET|SOFTWARE|ARTIFICIAL|DIGITAL|ROBOT|TELECOM|SEMICONDUCT)")),
    ("science", re.compile(r"^(SCIENCE|ENV_|NATURAL_DISASTER|CLIMATE|HEALTH|MEDICAL|DISEASE|EPIDEMIC|PANDEMIC|VACCIN|SPACE|WB_\d+_(?:HEALTH|ENVIRONMENT))")),
    ("culture", re.compile(r"^(CELEBRIT|MOVIE|MUSIC|ENTERTAIN|ARTS|FILM|FESTIVAL)")),
    ("world", re.compile(r"^(ARMEDCONFLICT|KILL|TERROR|REBEL|PROTEST|ARREST|CRIME|REFUGEE|ELECTION|GOV|LEADER|POLITIC|CORRUPT|DIPLOMA|SANCTION|CEASEFIRE|WAR|MILITARY|UNREST|IMMIGRATION|HUMAN_RIGHTS|LEGISLATION|JUSTICE|COURT)")),
]
# GDELT tags thousands of themes, most of them generic ("EDUCATION", "AFFECT"); show only meaningful ones.
WANT_THEME = re.compile(r"^(ECON_|ENV_|HEALTH_|ARMEDCONFLICT|TERROR|ELECTION|PROTEST|REFUGEES|IMMIGRATION|CYBER_ATTACK|"
                        r"NATURAL_DISASTER|SANCTIONS|CEASEFIRE|CORRUPTION|WMD|UNREST|CRISIS$|FOOD_SECURITY|KILL$|ARREST)")
THEME_NAMES = {
    "ARMEDCONFLICT": "Armed conflict", "ENV_CLIMATECHANGE": "Climate change", "ECON_STOCKMARKET": "Stock market",
    "ECON_INFLATION": "Inflation", "ECON_INTEREST_RATES": "Interest rates", "ECON_OILPRICE": "Oil prices",
    "ECON_TRADE_DISPUTE": "Trade dispute", "ELECTION": "Elections", "TERROR": "Terrorism", "KILL": "Killings",
    "PROTEST": "Protests", "REFUGEES": "Refugees", "IMMIGRATION": "Immigration", "CYBER_ATTACK": "Cyber attack",
    "NATURAL_DISASTER": "Natural disaster", "HEALTH_PANDEMIC": "Pandemic", "HEALTH_VACCINATION": "Vaccination",
    "SANCTIONS": "Sanctions", "CEASEFIRE": "Ceasefire", "CORRUPTION": "Corruption", "ARREST": "Arrests",
    "LEADER": "Leaders", "GOVERNMENT": "Government", "MILITARY": "Military", "WMD": "Weapons of mass destruction",
    "ENV_OIL": "Oil", "ENV_GAS": "Gas", "ENV_NUCLEARPOWER": "Nuclear power", "ENV_MINING": "Mining",
    "ECON_DEBT": "Debt", "ECON_BANKRUPTCY": "Bankruptcy", "UNREST": "Unrest", "CRISIS": "Crisis",
    "HEALTH_SEXTRANSDISEASE": "Sexual health", "FOOD_SECURITY": "Food security", "TRAFFIC": "Traffic",
}


def pretty_theme(t):
    if t in THEME_NAMES:
        return THEME_NAMES[t]
    t = re.sub(r"^(ECON|ENV|HEALTH|SOC|POL|WB_\d+)_", "", t)
    return t.replace("_", " ").capitalize()


def theme_domain(themes):
    score = collections.Counter()
    for t in themes:
        for d, rx in THEME_DOMAINS:
            if rx.match(t):
                score[d] += 1
                break
    if not score:
        return None
    best = max(score.values())
    for d, _ in THEME_DOMAINS:        # ties go to the earlier, more specific domain
        if score[d] == best:
            return d


# ---------------------------------------------------------------- GDELT

JUNK = re.compile(r"porn|xxx|escort|casino|betting|slot ?machine|viagra|onlyfans|\bsex(?:y|cam)\b|\bnude", re.I)
LOC_WEIGHT = {"1": .5, "2": .8, "3": 1.0, "4": 1.0, "5": .8}
# GDELT glues the "By" of a byline onto the author's name ("Byemily Gibbs"); real names like Byron stay.
BYLINE = re.compile(r"^By(?!ron\b|rne\b|ers\b|rd\b|un\b|ung\b)[a-z]{3,}\b")


def clean_title(t):
    t = strip_html(t)
    parts = re.split(r"\s+[|–—-]\s+", t)
    if len(parts) > 1 and len(parts[-1].split()) <= 4:     # drop a trailing " | Site Name"
        t = " | ".join(parts[:-1]) if len(parts) > 2 else parts[0]
    return t.strip(" -|–—")


def gdelt_stamps(kind, n):
    """The newest n 15-minute file stamps for 'gkg' (English) or 'translation' (everything else)."""
    name = "lastupdate.txt" if kind == "gkg" else "lastupdate-translation.txt"
    text = fetch(GDELT + name, 30).decode()
    m = re.search(r"/(\d{14})\.(?:translation\.)?gkg\.csv\.zip", text)
    last = dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S")
    return [(last - dt.timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(n)]


def parse_gkg(raw):
    """One GDELT GKG file -> (items, gazetteer entries). Columns used: 1 date, 3 outlet, 4 url,
    8 themes, 10 locations, 12 people, 14 organisations, 15 tone, 25 translation info, 26 extras."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    data = z.read(z.namelist()[0]).decode("utf-8", "replace")
    items, gaz = [], {}
    for line in data.split("\n"):
        r = line.split("\t")
        if len(r) < 27:
            continue
        m = re.search(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", r[26], re.S)
        if not m:
            continue
        title = re.sub(r"\s+", " ", clean_title(m.group(1)).replace("�", ""))
        outlet, link = r[3].strip().lower(), r[4].strip()
        if len(title) < 18 or len(title.split()) < 3 or not link.startswith("http") or JUNK.search(title + " " + outlet):
            continue
        lang = (re.search(r"srclc:(\w+)", r[25]) or [None, "eng"])[1]
        try:
            pub = dt.datetime.strptime(r[1], "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        # places (V2): type#name#country#adm1#adm2#lat#lon#id#offset
        locs = collections.defaultdict(float)
        tl = title.lower()
        # GDELT sometimes reads a surname as a place ("Burnham"): never pin on a word that is part of a person's name
        who = {w for p in r[12].split(";") for w in p.split(",")[0].lower().split()}
        for ent in r[10].split(";"):
            f = ent.split("#")
            if len(f) < 8 or f[0] not in LOC_WEIGHT or f[1].split(", ")[0].lower() in who:
                continue
            try:
                la, lo = float(f[5]), float(f[6])
            except ValueError:
                continue
            if (abs(la) < .01 and abs(lo) < .01) or abs(la) > 90 or abs(lo) > 180:
                continue
            parts = f[1].split(", ")
            disp = parts[0] if len(parts) == 1 else f"{parts[0]}, {parts[-1]}"
            key = (round(la, 2), round(lo, 2), disp)
            locs[key] += LOC_WEIGHT[f[0]] + (3 if parts[0].lower() in tl else 0)
            if f[0] in "134" and len(parts[0]) >= 4:
                gaz.setdefault(parts[0].lower(), {}).setdefault((la, lo, disp), 0)
                gaz[parts[0].lower()][(la, lo, disp)] += 1
        ranked = sorted(locs.items(), key=lambda kv: -kv[1])[:3]
        in_title = {k for k, _ in ranked if k[2].split(", ")[0].lower() in tl}
        themes = [t.split(",")[0] for t in r[8].split(";") if t]
        good = []
        for t in themes:
            if t and WANT_THEME.match(t) and t not in good:
                good.append(t)
        try:
            tone = float(r[15].split(",")[0])
        except ValueError:
            tone = 0.0
        items.append({
            "title": title, "link": link, "outlet": outlet, "published": pub, "summary": "", "hn": 0, "lang": lang,
            "locs": [k for k, _ in ranked], "loc_title": in_title, "themes": good[:6], "domain": classify_text(title, None) or theme_domain(themes),
            "people": [n for n in (p.split(",")[0].title() for p in r[12].split(";")[:6] if p) if not BYLINE.match(n)][:4],
            "orgs": [o.split(",")[0].title() for o in r[14].split(";")[:4] if o],
            "tone": tone, "src": "gkg",
        })
    return items, gaz


def collect_gdelt():
    jobs = [("gkg", s) for s in gdelt_stamps("gkg", GKG_EN_FILES)] + \
           [("translation", s) for s in gdelt_stamps("translation", GKG_TR_FILES)]

    def one(job):
        kind, stamp = job
        name = f"{stamp}.gkg.csv.zip" if kind == "gkg" else f"{stamp}.translation.gkg.csv.zip"
        try:
            return parse_gkg(fetch(GDELT + name, 90))
        except Exception:  # noqa: BLE001 - a missing or late file is normal
            return None

    items, gaz, got = [], collections.defaultdict(lambda: collections.defaultdict(int)), 0
    with ThreadPoolExecutor(4) as pool:
        for res in pool.map(one, jobs):
            if not res:
                continue
            got += 1
            its, g = res
            items += its
            for k, d in g.items():
                for ent, n in d.items():
                    gaz[k][ent] += n
    for k, d in gaz.items():           # the most-mentioned reading of each name wins ("Paris" is France)
        (la, lo, disp), n = max(d.items(), key=lambda kv: kv[1])
        PLACES[k] = (la, lo, disp)
    return items, got, len(jobs)


# ---------------------------------------------------------------- feeds and Hacker News

def collect_feeds(now):
    def one(feed):
        domain, outlet, url, home = feed
        try:
            out = []
            for e in parse_feed(fetch(url, 20)):
                if not e["title"] or not e["link"].startswith("http") or not e["published"]:
                    continue
                if (now - e["published"]).total_seconds() / 3600 > MAX_AGE_H or e["published"] > now + dt.timedelta(hours=1):
                    continue
                out.append(dict(e, outlet=outlet, home=home, hn=0, lang="eng", loc=None, themes=[], people=[], orgs=[],
                                tone=0.0, src="rss", domain=domain or classify_text(e["title"])))
            return outlet, out, None
        except Exception as exc:  # noqa: BLE001 - a bad feed must never stop the build
            return outlet, [], f"{outlet}: {type(exc).__name__}"

    items, ok, failed = [], [], []
    with ThreadPoolExecutor(8) as pool:
        for outlet, out, err in pool.map(one, FEEDS):
            (failed if err else ok).append(err or outlet)
            items += out
    try:
        ids = json.loads(fetch(HN_TOP, 20))[:30]

        def hn(i):
            try:
                return json.loads(fetch(HN_ITEM.format(i), 10) or b"{}")
            except Exception:  # noqa: BLE001
                return {}
        with ThreadPoolExecutor(8) as pool:
            for s in pool.map(hn, ids):
                if not s or s.get("type") != "story" or not s.get("title"):
                    continue
                pub = dt.datetime.fromtimestamp(s["time"], dt.timezone.utc)
                if (now - pub).total_seconds() / 3600 > MAX_AGE_H:
                    continue
                link = s.get("url") or f"https://news.ycombinator.com/item?id={s['id']}"
                items.append(dict(title=strip_html(s["title"]), link=link, summary="", published=pub, domain="tech",
                                  outlet="Hacker News", home=HN_HOME, hn=int(s.get("score", 0)), lang="eng", loc=None,
                                  themes=[], people=[], orgs=[], tone=0.0, src="rss"))
        ok.append("Hacker News")
    except Exception as exc:  # noqa: BLE001
        failed.append(f"Hacker News: {type(exc).__name__}")
    return items, ok, failed


# ---------------------------------------------------------------- clustering

STOP = set("""the and for with that this from have has had are was were will its into over after before more than
 about your you our their they them his her who what when how why new says said say out not but can may could would
 should just also been being amid via per get gets got off all one two now up out les des une pour dans que qui sur
 los las del por con una para que die der und das mit von den ein eine""".split())


def tokens(text):
    return {w for w in re.findall(r"[^\W_]{3,}", text.lower()) if w not in STOP}


def similar(a, b):
    if not a or not b:
        return False
    inter, ratio = len(a & b), len(a & b) / len(a | b)
    return (inter >= 3 and ratio >= 0.25) or (inter >= 2 and ratio >= 0.5)


def cluster(items):
    """Group items that cover the same story: same language, shared headline terms, different outlets.
    An inverted index keeps this fast with tens of thousands of articles."""
    clusters, index = [], collections.defaultdict(list)
    for it in sorted(items, key=lambda x: x["published"], reverse=True):
        toks = tokens(it["title"])
        cand = collections.Counter()
        for t in toks:
            lst = index.get(t)
            if lst and len(lst) < 400:
                cand.update(lst)
        hit = None
        for ci, _ in cand.most_common(10):
            c = clusters[ci]
            if c["lang"] == it["lang"] and it["outlet"] not in c["outlets"] and similar(toks, c["tokens"]):
                hit = c
                break
        if hit:
            hit["members"].append(it)
            hit["outlets"].add(it["outlet"])
        else:
            clusters.append({"lang": it["lang"], "tokens": toks, "members": [it], "outlets": {it["outlet"]}})
            for t in toks:
                index[t].append(len(clusters) - 1)
    return clusters


def top(counter, n):
    return [k for k, _ in counter.most_common(n)]


def build_stories(items, now):
    stories = []
    for c in cluster(items):
        ms = sorted(c["members"], key=lambda m: m["published"], reverse=True)
        reach = len(c["outlets"])
        # Wire copy is one voice: outlets running the identical headline count once toward `signal`.
        signal = max(1, min(reach, len({re.sub(r"\W+", " ", m["title"].lower()).strip() for m in ms})))
        named = any(m["src"] == "rss" for m in ms)
        if reach < 2 and not named:
            continue                       # a lone article from an unnamed outlet is not a story
        if c["lang"] != "eng" and reach < 2:
            continue
        # where: the place most of the coverage is about; else our own tagging of the headline
        # Consensus: each article votes for the places it is most about, and a place named in its
        # headline counts triple. One article's bad geocode cannot move the pin.
        votes = collections.Counter()
        for m in ms:
            for k in m.get("locs", ()):
                votes[k] += 3 if k in m.get("loc_title", ()) else 1
        if votes:
            la, lo, place = votes.most_common(1)[0][0]
            geo = "gdelt"
        else:
            rss = next((m for m in ms if m["src"] == "rss"), None)
            g = geotag(ms[0]["title"], rss["summary"] if rss else "", rss["home"] if rss else None)
            if not g:
                continue
            la, lo, place, geo = g
        # what: the domain most members agree on
        dvotes = collections.Counter(m["domain"] or classify_text(m["title"]) for m in ms)
        domain = dvotes.most_common(1)[0][0]
        lead = next((m for m in ms if m["lang"] == "eng"), ms[0])
        summary = max((m["summary"] for m in ms), key=len, default="")
        summary = (summary[:237].rsplit(" ", 1)[0] + "…") if len(summary) > 240 else summary
        hn = max(m["hn"] for m in ms)
        tones = [m["tone"] for m in ms if m["src"] == "gkg"]
        themes = collections.Counter(t for m in ms for t in m["themes"])
        people = collections.Counter(p for m in ms for p in m["people"])
        orgs = collections.Counter(o for m in ms for o in m["orgs"])
        age_h = (now - ms[0]["published"]).total_seconds() / 3600
        rank = signal * 10 + min(reach, 40) / 4 + min(hn / 100, 8) + (abs(sum(tones) / len(tones)) if tones else 0) - age_h / 6 + (3 if named else 0)
        thr = max(1, math.ceil(len(ms) * 0.3))     # keep only tags that a good share of the coverage agrees on
        slug = re.sub(r"[^\w]+", "-", ms[-1]["title"].lower()).strip("-")[:48]
        seen_out, srcs = set(), []
        for m in ms:
            if m["outlet"] in seen_out:
                continue
            seen_out.add(m["outlet"])
            srcs.append({"name": m["outlet"], "url": m["link"], "at": iso_utc(m["published"])})
        stories.append({
            "id": f"{domain}-{slug}", "kind": "story", "domain": domain, "title": lead["title"],
            "summary": summary, "lat": la, "lon": lo, "place": place, "geo": geo,
            "published": ms[0]["published"].date().isoformat(), "published_at": iso_utc(ms[0]["published"]),
            "signal": signal, "outlets": reach, "hn": hn or None, "lang": c["lang"],
            "confidence": "high" if signal >= 3 else "medium" if signal == 2 else "low",
            "themes": [pretty_theme(t) for t, n in themes.most_common(6) if n >= thr][:4],
            "people": [p for p, n in people.most_common(5) if n >= thr][:3], "orgs": [o for o, n in orgs.most_common(5) if n >= thr][:3],
            "tone": round(sum(tones) / len(tones), 1) if tones else None,
            "sources": srcs[:12], "_rank": rank,
        })
    stories.sort(key=lambda s: s["_rank"], reverse=True)
    out, per_place, ids = [], collections.Counter(), set()
    for s in stories:
        if len(out) >= MAX_STORIES:
            break
        if s["id"] in ids or per_place[s["place"]] >= PER_PLACE:
            continue
        ids.add(s["id"]); per_place[s["place"]] += 1
        out.append(s)
    for s in out:
        s.pop("_rank")
    return out


# ---------------------------------------------------------------- main

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

    stories, ok, failed, mode, note, stats = [], [], [], "snapshot", cur.get("snapshot_note", ""), {}
    if not args.offline:
        gk, got, wanted = [], 0, 0
        try:
            gk, got, wanted = collect_gdelt()
        except Exception as exc:  # noqa: BLE001
            failed.append(f"GDELT: {type(exc).__name__}")
        fi, ok, f2 = collect_feeds(now)
        failed += f2
        if got:
            ok.insert(0, f"GDELT ({got}/{wanted} files)")
        elif not any(f.startswith("GDELT") for f in failed):
            failed.append("GDELT: no files")
        seen, items = set(), []
        for it in gk + fi:                  # one article, one vote
            if it["link"] in seen:
                continue
            seen.add(it["link"]); items.append(it)
        stories = build_stories(items, now)
        stats = {
            "articles": len(items), "outlets": len({i["outlet"] for i in items}),
            "languages": len({i["lang"] for i in items}), "feeds": len(ok),
            "window_hours": round(max(GKG_EN_FILES, GKG_TR_FILES) * 15 / 60, 1), "gdelt_files": got,
        }
    # Require some corroboration of life: at least 20 stories, else keep the last good set.
    if len(stories) >= 20:
        mode = "live"
        note = (f"Scanned {stats['articles']:,} articles from {stats['outlets']:,} outlets in {stats['languages']} languages. "
                "Events and releases are hand-curated.")
    else:
        prev_stories = [i for i in prev.get("items", []) if i.get("kind") == "story"]
        stories = prev_stories or [dict(s, kind="story") for s in cur["seed_stories"]]
        stats = prev.get("stats", {})
        if prev.get("mode") == "live" and prev_stories:
            mode, note = "live", prev.get("note", "") + " (Last build could not reach the sources; showing the previous stories.)"
        failed = failed or ([] if args.offline else ["no live stories"])

    today = now.date().isoformat()
    events = [dict(e, kind="event") for e in cur["events"] if e["end"] >= today]
    releases = [dict(r, kind="release") for r in cur["releases"] if r["end"] >= today]
    out = {
        "generated": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "mode": mode, "note": note, "stats": stats, "feeds_ok": ok, "feeds_failed": failed,
        "items": stories + events + releases,
    }
    # `generated` means "the content last changed": if only the clock moved, keep the file as it was.
    if prev and {k: v for k, v in prev.items() if k != "generated"} == {k: v for k, v in out.items() if k != "generated"}:
        print("no change in content; data.json left as it was")
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    n = {k: sum(1 for i in out["items"] if i["kind"] == k) for k in ("story", "event", "release")}
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB): mode={mode} {n} ok={len(ok)} failed={len(failed)} {stats}")


if __name__ == "__main__":
    main()
