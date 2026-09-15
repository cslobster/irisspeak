#!/usr/bin/env python3
"""Build the study vocabulary (target ~3000 cards) from:
  1. CBoard Classic (cbc) - always included, the base vocabulary
  2. Project Core Universal Core 36 (pc36) - always included, core
  3. Consensus across the Open Board Format comparison word lists
     (Quick Core, WordPower, LAMP WFL, Speak For Yourself, Super Core,
     Vocal Flair, Voco Chat, CBoard Universal Core, Sequoia ...)
  4. Frequency evidence from AAC-like corpora (aactext.org "imagine"
     crowdsourced communications + Vertanen turk dialogues)
  5. A curated set of safety / repair / social / autonomy cards that AAC
     practice requires and that the source lists under-represent.

Outputs (in the directory given by --out):
  vocab.csv       one row per card with metadata
  registry.json   append-only id registry + version hash
  report.md       counts by source, tier, category, intent
  unmatched.txt   candidate words seen often in corpora but not selected
"""
import argparse, csv, glob, hashlib, json, os, re, collections, sys
import nltk
from nltk.corpus import wordnet as wn
from nltk.stem import WordNetLemmatizer
from nltk import pos_tag

LEM = WordNetLemmatizer()

# ---------------------------------------------------------------- normalise
SPELL_FIX = {
    "deoderant": "deodorant", "brussel sprouts": "brussels sprouts",
    "mash potato": "mashed potato", "jewelry": "jewellery", "sprig onions": "spring onions",
}
# UK label -> US alias (CBC is UK English). Both are kept: label = UK, alias = US.
UK_US = {
    "aeroplane": "airplane", "aubergine": "eggplant", "autumn": "fall",
    "biscuits": "cookies", "chips": "fries", "crisps": "chips",
    "colour": "color", "cooker": "stove", "courgette": "zucchini",
    "dummy": "pacifier", "football": "soccer", "garden": "yard",
    "holiday": "vacation", "ice lolly": "popsicle", "jumper": "sweater",
    "lorry": "truck", "mum": "mom", "nappy": "diaper", "pavement": "sidewalk",
    "plaster": "band-aid", "rubbish": "trash", "sweets": "candy",
    "toilet": "bathroom", "trainers": "sneakers", "trousers": "pants",
    "wardrobe": "closet", "maths class": "math class", "mobile": "cell phone",
    "petrol": "gas", "post": "mail", "queue": "line", "tap": "faucet",
    "torch": "flashlight", "vest": "undershirt", "back garden": "backyard",
    "lemonade": "soda", "boxer shorts": "boxers", "bobble hat": "beanie",
}
EXTRA_ALIASES = {
    "i want": ["i would like", "i'd like", "i wanna", "want"],
    "i need": ["i have to", "i've got to", "need"],
    "i dislike": ["i don't like", "i hate"],
    "i'm hungry": ["i am hungry", "hungry"],
    "i'm thirsty": ["i am thirsty", "thirsty"],
    "i have pain in": ["it hurts", "my ... hurts", "pain"],
    "i can't speak": ["i cannot speak", "i use a device to talk"],
    "yes": ["yeah", "yep", "ok", "okay", "sure"],
    "no": ["nope", "nah"],
    "hello": ["hi", "hey"],
    "goodbye": ["bye", "see you"],
    "dad": ["father", "daddy", "papa"],
    "mum": ["mother", "mummy", "mom", "mommy", "mama"],
    "grandmother": ["grandma", "nan", "nana", "granny"],
    "grandfather": ["grandpa", "grandad", "granddad"],
    "toilet": ["bathroom", "restroom", "loo", "wc"],
    "finished": ["done", "all done", "i'm done"],
    "more": ["again", "another"],
    "help": ["help me", "i need help"],
}

def norm(s):
    s = s.strip().lower().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s+", " ", s)
    s = s.strip(" .,:;\"!?")
    return SPELL_FIX.get(s, s)

def valid_label(s):
    if not s or len(s) > 40: return False
    if len(s) == 1 and s not in ("i", "a"): return False
    if not re.fullmatch(r"[a-z0-9' \-]+", s): return False
    if re.fullmatch(r"[0-9 ]+", s): return False     # bare digits
    if s.startswith("-") or s.endswith("-"): return False
    return True

# ---------------------------------------------------------------- curated
CURATED = {
  # intent -> cards. These are added regardless of consensus.
  "affirm":  ["yes", "ok", "sure", "i agree", "that's right", "good idea", "i like that", "all done", "finished"],
  "refuse":  ["no", "not now", "i don't want to", "i don't like that", "stop", "leave me alone",
              "don't touch me", "no thank you", "not that one", "i'm not finished", "go away", "enough"],
  "request": ["i want", "i need", "i want more", "help", "i need help", "i need help now", "can i have",
              "give me", "show me", "come here", "wait", "let's go", "i want to go", "i want to stop",
              "i want something else", "i want a break", "i need the toilet", "i need my medicine",
              "can you help me", "please", "more", "again", "different", "turn it on", "turn it off",
              "open it", "i want to play", "i want to eat", "i want to drink", "i want to watch",
              "i want to listen", "i want to go home", "i want to go outside", "i want to be alone"],
  "safety":  ["i feel sick", "i'm in pain", "it hurts", "it hurts here", "i feel dizzy", "i can't breathe",
              "i'm scared", "i'm hurt", "call my mum", "call my dad", "call a doctor", "call for help",
              "emergency", "i'm going to be sick", "i need to lie down", "i'm too hot", "i'm too cold",
              "someone is hurting me", "i don't feel safe", "i need a quiet place"],
  "repair":  ["say it again", "i don't understand", "that's not what i meant", "i mean", "let me finish",
              "i'm thinking", "give me time", "i don't know", "something else", "not that", "start over",
              "spell it", "i'll show you", "look at my board", "wrong one", "oops", "never mind",
              "you understood me", "you didn't understand me", "ask me yes or no questions"],
  "social":  ["hello", "goodbye", "thank you", "you're welcome", "sorry", "excuse me", "how are you",
              "i'm fine", "i'm good", "good morning", "good afternoon", "good night", "see you later",
              "nice to meet you", "what's your name", "my name is", "i'm happy to see you",
              "that's funny", "i love you", "happy birthday", "congratulations", "good luck", "have fun",
              "what's up", "how was your day", "tell me more", "i'm listening", "cool", "awesome"],
  "question":["what", "who", "where", "when", "why", "how", "which", "what is it", "what's that",
              "where is it", "who is that", "what time is it", "can i", "can you", "do you", "is it",
              "what are we doing", "what happened", "where are we going", "when are we going",
              "how much", "how many", "how long", "what do you think", "are you ok"],
  "feeling": ["happy", "sad", "angry", "scared", "tired", "bored", "excited", "worried", "confused",
              "frustrated", "calm", "silly", "proud", "lonely", "surprised", "nervous", "sick",
              "hungry", "thirsty", "hot", "cold", "in pain", "uncomfortable", "comfortable", "ok",
              "i feel", "i'm happy", "i'm sad", "i'm angry", "i'm tired", "i'm bored", "i'm ok"],
  "number":  ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
              "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty",
              "thirty","forty","fifty","hundred","first","second","third","half"],
  # words surfaced by data/map.py unmapped reports (vocabulary backlog loop)
  "backlog": ["speak", "clear", "medication", "sleepy", "moment", "quick", "machine", "online", "garbage",
              "vet", "trust", "grab", "everyday", "thankful", "loudly", "traffic", "market", "convey",
              "bless", "aid", "dude", "indeed", "legs", "hearing aid", "speech device", "my talker",
              "communication book", "i use this to talk", "wait for me to finish", "i'll type it",
              "oh", "absolutely", "hopefully", "unfortunately", "favourite", "yum", "haha", "wow", "hmm",
              "doctor's", "haircut", "massage", "outfit", "noise", "screen", "advice", "sale", "lawn",
              "curry", "festival", "community", "culture", "tradition", "comedy", "energy", "experience"],
  "answer":  ["maybe", "i think so", "i don't think so", "not yet", "later", "soon", "now", "a little",
              "a lot", "all", "some", "none", "nothing", "everything", "both", "neither", "it depends",
              "sometimes", "always", "never", "probably", "of course", "kind of", "not really"],
  "core":    ["i", "you", "he", "she", "it", "we", "they", "me", "my", "your", "mine", "yours", "this",
              "that", "these", "those", "here", "there", "what", "not", "don't", "can't", "do", "did",
              "is", "am", "are", "was", "were", "be", "have", "has", "had", "can", "will", "would",
              "could", "should", "want", "need", "like", "love", "help", "stop", "go", "come", "get",
              "put", "make", "do", "look", "see", "hear", "feel", "think", "know", "say", "tell",
              "give", "take", "eat", "drink", "play", "read", "watch", "listen", "sleep", "sit",
              "stand", "walk", "run", "open", "close", "turn", "on", "off", "in", "out", "up", "down",
              "over", "under", "with", "without", "to", "for", "of", "and", "or", "but", "because",
              "if", "so", "too", "very", "more", "less", "same", "different", "good", "bad", "big",
              "little", "fast", "slow", "all", "some", "many", "much", "finished", "again", "also",
              "now", "later", "before", "after", "today", "tomorrow", "yesterday", "morning",
              "afternoon", "evening", "night", "always", "never", "sometimes"],
}
CURATED_NEG = {  # entries to drop from any source list (board navigation / meta / junk)
  "aac", "abc", "keyboard", "home", "back", "delete", "undo", "space", "settings",
  "quick", "phrases", "categories", "core", "fringe", "page", "next page", "go back", "board", "folder",
}
# "home" and "back" are real words too; keep them via curated re-add below.
CURATED_READD = {"home", "back"}

NUMBER_WORDS = {"zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven",
  "twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty","thirty",
  "forty","fifty","sixty","seventy","eighty","ninety","hundred","thousand","million","first","second",
  "third","fourth","fifth","half","quarter","twenty one","twenty two","twenty five","thirty one",
  "sixth","seventh","eighth","ninth","tenth","last","next"}
COLOR_WORDS = {"red","blue","green","yellow","orange","purple","pink","black","white","brown","grey",
  "gray","mauve","gold","silver","turquoise","navy","beige","violet","indigo","tan","maroon"}
DRINK_WORDS = {"juice","milk","water","coffee","tea","milkshake","lemonade","soda","cola","beer","wine",
  "smoothie","hot chocolate","cocoa","squash","drink","cider","shake"}
FEELING_WORDS = {"happy","sad","angry","mad","scared","afraid","tired","sleepy","bored","excited","worried",
  "confused","frustrated","calm","silly","proud","lonely","surprised","nervous","upset","grumpy","shy",
  "embarrassed","jealous","disappointed","anxious","stressed","relaxed","comfortable","uncomfortable",
  "hungry","thirsty","hot","cold","sick","ok","fine","great","terrible","awful","glad","cheerful",
  "annoyed","furious","love","hate","like","joy","fear","anger","hope","wish","surprise","feelings",
  "feeling","feel","in pain","hurt","brave","curious","guilty","safe","unsafe","overwhelmed"}
WH = {"what","who","where","when","why","how","which","whose"}
PRON = {"i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our",
  "their","mine","yours","hers","ours","theirs","myself","yourself","this","that","these","those",
  "someone","something","anyone","anything","everyone","everything","nobody","nothing","somebody"}
AUX = {"am","is","are","was","were","be","been","being","do","does","did","have","has","had","can",
  "could","will","would","shall","should","may","might","must","don't","doesn't","didn't","can't",
  "won't","wouldn't","couldn't","shouldn't","isn't","aren't","wasn't","weren't","haven't","hasn't"}
PREP_CONJ = {"in","on","at","to","for","of","with","without","from","by","about","over","under","up",
  "down","out","off","into","onto","near","between","behind","in front","around","through","after",
  "before","and","or","but","because","if","so","then","than","as","until","while","also","too","not",
  "very","really","just","only","again","here","there","now","yet","still","almost","maybe"}
BODY_EXTRA = {"tummy","belly","bum","bottom","private parts","willy","boobs"}
HEALTH_WORDS = {"pain","ache","headache","back ache","tummy ache","earache","toothache","medicine",
  "inhaler","tablet","tablets","pill","pills","doctor","nurse","dentist","hospital","sick","ill",
  "hurt","hurts","itch","itchy","sore","cough","cold","flu","fever","temperature","blood pressure",
  "injection","bandage","plaster","wheelchair","seizure","allergy","allergic","vomit","diarrhoea",
  "period","cramp","dizzy","nausea","medication","therapy","physio","appointment","ambulance"}

BLOCK = {"senate","liberal","conservative","republican","democrat","abortion","atm","suction","x-ray",
  "loser","troll","monk","sage","hymnal","sacrament","ozone layer","tsunami","gross","grand","euro",
  "fortune","bolt","drag","chop","stays","letting","minding","exact","bloody","united","evil",
  "medium","appendix","consent","score","act","tag","spinner","eve","line","character","band","meeting",
  "yesterday was","after while crocodile","to sleep male","chicken live","it assistant","no class",
  "climate change","pool snooker","usb stick","assistive technology","pyramids of giza"}
SCHOOL_WORDS = {"school","teacher","class","lesson","homework","classroom","pencil","pen","paper","book",
  "notebook","crayon","glue","scissors","ruler","desk","blackboard","whiteboard","calculator","backpack",
  "lunch box","recess","playground","library","gym","assembly","test","exam","quiz","grade","reading",
  "writing","spelling","maths","math","science","history","geography","art","music","pe","computer class",
  "student","principal","headteacher","teaching assistant","bus","lunch","break time","circle time",
  "worksheet","folder","sticker","reward","turn","line up","raise hand","listen","copy","finish","learn"}
TECH_WORDS = {"phone","mobile","iphone","ipad","tablet","computer","laptop","tv","television","remote",
  "internet","wifi","video","game","games","video game","app","youtube","netflix","music","headphones",
  "charger","battery","screen","keyboard","mouse","camera","photo","picture","message","text","email",
  "call","facetime","zoom","speaker","volume","switch","button","device","my device","talker","ipod",
  "dvd player","radio","website","password","robot","electric charger","computer keyboard","computer mouse"}
def is_proper_instance(word):
    """True when every noun sense of the word is a named instance (Arizona, Greece, Mars)."""
    syns=[x for x in wn.synsets(word.replace(" ","_")) if x.pos()=="n"]
    if not syns: return False
    return all(x.instance_hypernyms() for x in syns) and not any(x.pos()!="n" for x in wn.synsets(word.replace(" ","_")))

def hyper_closure(syn):
    seen=set(); stack=[syn]
    while stack:
        s=stack.pop()
        for h in s.hypernyms()+s.instance_hypernyms():
            if h.name() not in seen:
                seen.add(h.name()); stack.append(h)
    return seen

def wn_category(word):
    """Category for a single word via WordNet lexnames + hypernyms."""
    syns = wn.synsets(word.replace(" ", "_"))
    if not syns: return None
    key = word.replace(" ", "_")
    def cnt(s):
        return sum(l.count() for l in s.lemmas() if l.name().lower()==key)
    wt = collections.Counter()
    for i,s in enumerate(syns): wt[s.pos() if s.pos()!="s" else "a"] += cnt(s) + (0.5 if i==0 else 0)
    best = wt.most_common(1)[0][0]
    nouns=[s for s in syns if s.pos()=="n"]; verbs=[s for s in syns if s.pos()=="v"]
    adjs=[s for s in syns if s.pos() in ("a","s")]; advs=[s for s in syns if s.pos()=="r"]
    if best=="n" and nouns:
        s=max(nouns,key=cnt); ln=s.lexname(); hy=hyper_closure(s)
        if "clothing.n.01" in hy: return "clothes"
        if "vehicle.n.01" in hy or "conveyance.n.03" in hy: return "transport"
        if "furniture.n.01" in hy or "home_appliance.n.01" in hy or "kitchen_utensil.n.01" in hy: return "home"
        if "toy.n.03" in hy or "game.n.01" in hy or "sport.n.01" in hy: return "play"
        if "beverage.n.01" in hy: return "drink"
        if "musical_instrument.n.01" in hy: return "music"
        if "instrumentality.n.03" in hy and ln=="noun.artifact": return "things"
        if ln=="noun.group": return "people" if ("social_group.n.01" in hy or "people.n.01" in hy) else "things"
        if ln=="noun.person" and "person.n.01" not in hy: return "things"
        return {"noun.food":"food","noun.animal":"animals","noun.person":"people","noun.body":"body",
                "noun.artifact":"things","noun.location":"places","noun.feeling":"feelings",
                "noun.time":"time","noun.plant":"nature","noun.object":"nature","noun.substance":"things",
                "noun.act":"activities","noun.event":"activities","noun.state":"describing",
                "noun.attribute":"describing","noun.quantity":"quantity","noun.cognition":"ideas",
                "noun.communication":"ideas","noun.group":"people","noun.phenomenon":"weather",
                "noun.possession":"things","noun.shape":"describing","noun.relation":"ideas",
                "noun.motive":"feelings","noun.process":"activities","noun.Tops":"things"}.get(ln,"things")
    if best=="v" and verbs: return "actions"
    if best in ("a","r"): return "describing"
    if verbs: return "actions"
    if adjs or advs: return "describing"
    return None

def classify(label, list_count, is_core_list):
    """Return (category, pos, intent)."""
    w = label; toks = w.split()
    # --- intent by pattern
    intent = "content"
    for k, arr in CURATED.items():
        if w in arr and k not in ("core", "feeling", "answer"):
            intent = k; break
    if intent == "content":
        if w in WH or (toks[0] in WH) or w.endswith("?") or toks[0] in ("can","could","do","does","did","is","are","will","would","may") and len(toks)>1:
            intent = "question"
        elif re.match(r"^(i want|i need|i'd like|can i|give me|let's|i want to|help)\b", w): intent = "request"
        elif re.match(r"^(no|not|don't|stop|never|i don't want)\b", w) and len(toks) > 1 or w in ("no","stop","never"): intent = "refuse"
        elif re.match(r"^(yes|ok|okay|sure|yeah)\b", w): intent = "affirm"
        elif re.match(r"^(hello|hi|bye|goodbye|thank|thanks|sorry|please|good (morning|night|afternoon))\b", w): intent = "social"
        elif re.match(r"^(i feel|i'm|i am) ", w): intent = "feeling"
    # --- category
    if w in NUMBER_WORDS: return ("numbers", "num", intent)
    if w in TECH_WORDS: return ("technology", "noun", intent)
    if w in SCHOOL_WORDS or w.endswith(" class"): return ("school", "noun", intent)
    if w in COLOR_WORDS: return ("colours", "adj", intent)
    if w in FEELING_WORDS or (toks[0] in ("i'm","i feel","i am") and toks[-1] in FEELING_WORDS):
        return ("feelings", "adj" if len(toks)==1 else "phrase", "feeling" if intent=="content" else intent)
    if w in WH: return ("questions", "wh", "question")
    if w in PRON: return ("core", "pron", intent)
    if w in AUX: return ("core", "aux", intent)
    if w in PREP_CONJ: return ("core", "func", intent)
    if w in DRINK_WORDS or (toks[-1] in DRINK_WORDS): return ("drink", "noun", intent)
    if w in HEALTH_WORDS or toks[-1] in HEALTH_WORDS or "pain" in toks or "hurt" in w: return ("health", "noun", intent if intent!="content" else "content")
    if w in BODY_EXTRA: return ("body", "noun", intent)
    if intent in ("safety","repair","social","affirm","refuse","request","question") and len(toks)>1:
        return ("phrases", "phrase", intent)
    if len(toks) == 1:
        cat = wn_category(w)
        tag = pos_tag([w])[0][1]
        pos = {"NN":"noun","NNS":"noun","VB":"verb","VBP":"verb","VBD":"verb","VBG":"verb","VBN":"verb","VBZ":"verb",
               "JJ":"adj","JJR":"adj","JJS":"adj","RB":"adv","IN":"func","DT":"func","CC":"func","PRP":"pron",
               "PRP$":"pron","MD":"aux","CD":"num","UH":"interj","WP":"wh","WRB":"wh"}.get(tag, "other")
        if cat is None: cat = {"verb":"actions","adj":"describing","adv":"describing","interj":"social"}.get(pos,"things")
        if cat == "feelings" and intent == "content": intent = "feeling"
        if pos in ("func","pron","aux") and cat != "core" and list_count >= 8: cat = "core"
        return (cat, pos, intent)
    # multiword: phrase if starts with pronoun/aux/verb, else head-noun category
    if toks[0] in PRON or toks[0] in AUX or toks[0] in ("let's","please","i'm","i've","i'll","don't","can't"):
        return ("phrases", "phrase", intent if intent!="content" else "statement")
    head = toks[-1]
    cat = wn_category(w) or wn_category(head) or "things"
    if cat == "actions" and (toks[0].startswith("to ") or w.startswith("to ")): cat = "activities"
    if w.startswith("to "): cat = "activities"
    return (cat, "noun" if cat not in ("actions","activities","describing") else "phrase", intent)

# ---------------------------------------------------------------- corpora
def corpus_tokens(scratch):
    texts=[]
    for f in glob.glob(os.path.join(scratch,"aac_comm","aac_comm","sent_*_aac.txt")):
        texts += open(f, encoding="utf-8", errors="ignore").read().splitlines()
    td = os.path.join(scratch,"turk-dialogues.txt")
    if os.path.exists(td):
        for line in open(td, encoding="utf-8", errors="ignore").read().splitlines()[1:]:
            parts=line.split("\t")
            texts += parts[2:]
    text = "\n".join(t.lower().replace("’","'") for t in texts)
    toks = re.findall(r"[a-z']+", text)
    uni = collections.Counter(toks)
    lem = collections.Counter()
    for t,c in uni.items():
        lem[LEM.lemmatize(LEM.lemmatize(t,"v"),"n")] += c
    return text, uni, lem, len(texts)

# ---------------------------------------------------------------- main
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--lists", required=True, help="dir with <code>.txt OBF word lists")
    ap.add_argument("--scratch", required=True, help="dir containing aac_comm/ and turk-dialogues.txt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-lists", type=int, default=4, help="candidate pool threshold (quotas do the real selection)")
    ap.add_argument("--min-freq", type=int, default=25, help="corpus freq threshold for 2-list words")
    ap.add_argument("--registry", default=None, help="existing registry.json to keep ids stable")
    a=ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    lists={}
    for f in sorted(glob.glob(os.path.join(a.lists,"*.txt"))):
        code=os.path.basename(f)[:-4]
        raw=open(f,encoding="utf-8",errors="ignore").read()
        if "<html" in raw or code=="ac99": continue   # error page / keyboard list
        lists[code]={norm(l) for l in raw.splitlines() if valid_label(norm(l))}
    nlists=len(lists)
    count=collections.Counter(w for s in lists.values() for w in s)
    cbc=lists.get("cbc",set()); pc36=lists.get("pc36",set())

    text, uni, lem, nsent = corpus_tokens(a.scratch)
    def cfreq(w):
        if " " in w or "'" in w:
            return len(re.findall(r"(?<![a-z'])"+re.escape(w)+r"(?![a-z'])", text))
        return max(uni.get(w,0), lem.get(LEM.lemmatize(LEM.lemmatize(w,"v"),"n"),0))

    curated_all={w for arr in CURATED.values() for w in arr}
    cands=set(count) | curated_all | CURATED_READD
    KEEP_INFLECTED = {"people","children","feet","teeth","men","women","mice","glasses","clothes","pants",
                      "shorts","jeans","scissors","stairs","news","thanks","went","was","were","is","are",
                      "has","had","did","does","done","gone","been","better","best","worse","worst"}
    folded={}   # inflected -> lemma
    for w in list(cands):
        if " " in w or "'" in w or w in KEEP_INFLECTED or w in curated_all or w in pc36 or w in cbc: continue
        for pos in ("n","v","a"):
            lm = wn.morphy(w, pos)
            if lm and lm != w and lm in cands and count.get(lm,0) >= 2:
                folded[w]=lm; break
    for w,lm in folded.items():
        count[lm] = max(count.get(lm,0), count.get(w,0))   # lemma inherits evidence
        cands.discard(w)
    fold_aliases=collections.defaultdict(list)
    for w,lm in folded.items(): fold_aliases[lm].append(w)
    core_thr = max(6, int(round(0.78*nlists)))
    rows=[]
    for w in sorted(cands):
        if not valid_label(w): continue
        if w in CURATED_NEG and w not in CURATED_READD: continue
        lc=count.get(w,0); fq=cfreq(w)
        src=[]
        if w in cbc: src.append("cbc")
        if w in pc36: src.append("pc36")
        if w in curated_all or w in CURATED_READD: src.append("curated")
        if lc>=a.min_lists: src.append(f"consensus{lc}")
        elif lc>=2 and fq>=a.min_freq: src.append(f"corpus{fq}")
        if not src: continue
        cat,pos,intent=classify(w, lc, False)
        core = (w in pc36) or (w in CURATED["core"]) or (lc >= core_thr and cat in
               ("core","actions","describing","questions","quantity","time","feelings","phrases","numbers","colours"))
        if core and cat in ("things","describing","actions") and pos in ("pron","aux","func"): cat="core"
        aliases=[]
        if w in UK_US: aliases.append(UK_US[w])
        aliases += EXTRA_ALIASES.get(w,[])
        aliases += sorted(fold_aliases.get(w,[]))[:6]
        tier = "core" if core else ("cbc" if w in cbc else ("curated" if "curated" in src else "fringe"))
        safety = intent in ("safety","refuse","repair") or w in ("help","stop","no","i need help")
        rows.append(dict(score=0, label=w, aliases="|".join(dict.fromkeys(aliases)), category=cat, pos=pos, intent=intent,
                         core=int(core), safety=int(safety), tier=tier, sources="+".join(src),
                         list_count=lc, corpus_freq=fq))

    # ---- curated selection: mandatory sets bypass quotas; everything else competes on a usefulness
    #      score inside a per-category quota. This is a choice of the most useful cards, not a union.
    import math
    QUOTA = {"actions":330,"describing":240,"phrases":300,"people":120,"food":190,"drink":40,"body":60,
             "health":70,"feelings":80,"places":90,"things":280,"home":60,"clothes":50,"animals":100,
             "school":70,"activities":110,"play":50,"transport":40,"time":100,"numbers":40,"colours":16,
             "weather":25,"nature":60,"ideas":70,"music":15,"quantity":20,"questions":10,"technology":40,
             "core":200}
    def score(r):
        return (10*r["list_count"]/nlists + 1.5*math.log1p(r["corpus_freq"]) + 3*("cbc" in r["sources"])
                + 3*("curated" in r["sources"]) + 5*("pc36" in r["sources"]) - 1.5*(len(r["label"].split())>3))
    keep=[]; bucket=collections.defaultdict(list); dropped=collections.Counter()
    seen_dedup=set()
    for r in rows:
        w=r["label"]; mandatory = ("cbc" in r["sources"]) or ("pc36" in r["sources"]) or ("curated" in r["sources"])
        base=w.rstrip("!?").strip()
        if w in BLOCK or (base in BLOCK): dropped["blocklist"]+=1; continue
        if not mandatory and (is_proper_instance(w) or (" " in w and any(is_proper_instance(t) for t in w.split() if len(t)>3))):
            dropped["proper_noun"]+=1; continue
        if base in seen_dedup: dropped["punct_dup"]+=1; continue
        seen_dedup.add(base)
        if not mandatory and w.startswith("to ") and w[3:] in cands: dropped["infinitive_dup"]+=1; continue
        if not mandatory and len(w)>28: dropped["too_long"]+=1; continue
        r["score"]=round(score(r),2)
        if mandatory or r["core"]: keep.append(r)
        else: bucket[r["category"]].append(r)
    for cat,arr in bucket.items():
        arr.sort(key=lambda r:-r["score"])
        q=QUOTA.get(cat,50); keep+=arr[:q]; dropped[f"quota_{cat}"]+=max(0,len(arr)-q)
    rows=keep
    # ---- multiword handling for training: mark composable phrases, drop free compositions
    single={r["label"]:r for r in rows if " " not in r["label"]}
    alias2single={}
    for r in rows:
        if " " in r["label"]: continue
        for al in r["aliases"].split("|"):
            if al and " " not in al: alias2single.setdefault(al, r["label"])
    CONTR={"i'm":"i","i've":"i","i'll":"i","i'd":"i","don't":"not","can't":"not","won't":"not","didn't":"not",
           "doesn't":"not","isn't":"not","aren't":"not","it's":"it","that's":"that","what's":"what","let's":"let",
           "you're":"you","we're":"we","they're":"they","he's":"he","she's":"she","there's":"there","where's":"where"}
    def comp_of(w):
        ids=[]
        for t in w.split():
            t2=CONTR.get(t,t)
            cand = single.get(t2) or single.get(alias2single.get(t2,"")) or single.get(wn.morphy(t2) or "")
            if not cand: return None
            ids.append(cand["id"] if "id" in cand else cand["label"])
        return ids
    pruned=collections.Counter(); final=[]
    for r in rows:
        w=r["label"]; n=len(w.split()); r["words"]=n
        comps = comp_of(w) if n>1 else None
        r["composable"]=int(bool(comps)); r["components"]="|".join(comps) if comps else ""
        mandatory=("cbc" in r["sources"]) or ("pc36" in r["sources"]) or ("curated" in r["sources"])
        pragmatic = r["intent"]!="content" or r["category"] in ("phrases","feelings","health")
        if n>1 and comps and not mandatory and not pragmatic:
            # free composition already expressible with single cards: keep only strongly lexicalised compounds
            if n>=3 or r["list_count"]<6: pruned["free_composition"]+=1; continue
        final.append(r)
    rows=final
    def speak(w):
        t=w.split(); out=[]
        for i,x in enumerate(t):
            if x=="i" or x.startswith("i'"): x="I"+x[1:]
            out.append(x)
        sp=" ".join(out); return sp[0].upper()+sp[1:]
    for r in rows: r["speak"]=speak(r["label"])
    print("dropped:",dict(dropped),"pruned:",dict(pruned),file=sys.stderr)

    # ---- ids: keep existing registry ids, append new ones
    reg={}
    if a.registry and os.path.exists(a.registry):
        reg={e["label"]:e["id"] for e in json.load(open(a.registry))["cards"]}
    order=sorted(rows, key=lambda r:(0 if r["tier"]=="core" else 1 if r["tier"]=="cbc" else 2 if r["tier"]=="curated" else 3, r["label"]))
    nxt=len(reg)
    for r in order:
        if r["label"] not in reg:
            reg[r["label"]]=f"card_{nxt:04d}"; nxt+=1
        r["id"]=reg[r["label"]]
    lab2id={r["label"]:r["id"] for r in order}
    for r in order:
        if r["components"]:
            r["components"]="|".join(lab2id.get(c,c) for c in r["components"].split("|"))
    order.sort(key=lambda r:r["id"])
    version=hashlib.sha256("\n".join(r["id"]+"\t"+r["label"] for r in order).encode()).hexdigest()[:12]

    cols=["id","label","speak","aliases","category","pos","intent","core","safety","tier","words","composable","components","sources","list_count","corpus_freq","score"]
    with open(os.path.join(a.out,"vocab.csv"),"w",newline="") as f:
        wr=csv.DictWriter(f,fieldnames=cols); wr.writeheader()
        for r in order: wr.writerow({k:r[k] for k in cols})
    json.dump({"version":version,"n_cards":len(order),"special":["<aac_start>","<aac_end>"],
               "cards":[{"id":r["id"],"label":r["label"]} for r in order]},
              open(os.path.join(a.out,"registry.json"),"w"),indent=0)

    # ---- unmatched: frequent corpus words not selected
    sel={r["label"] for r in order}
    stop=set(nltk.corpus.stopwords.words("english"))
    unm=[(w,c) for w,c in lem.most_common(3000) if w not in sel and w not in stop and len(w)>2 and c>=8]
    with open(os.path.join(a.out,"unmatched.txt"),"w") as f:
        for w,c in unm: f.write(f"{w}\t{c}\n")

    # ---- corpus coverage: share of corpus tokens whose lemma (or the token) is a card label/alias
    labels={r["label"] for r in order} | {a for r in order for a in r["aliases"].split("|") if a}
    tot=sum(uni.values()); cov=0
    for t,c in uni.items():
        if t in labels or LEM.lemmatize(LEM.lemmatize(t,"v"),"n") in labels or wn.morphy(t) in labels: cov+=c
    coverage=cov/tot if tot else 0
    # ---- report
    by=lambda k: collections.Counter(r[k] for r in order).most_common()
    L=[f"# Vocabulary build report\n", f"version: `{version}`  cards: **{len(order)}**  "
       f"lists used: {nlists} ({', '.join(sorted(lists))})  corpus sentences: {nsent}\n",
       f"thresholds: consensus >= {a.min_lists} lists, or >= 2 lists and corpus freq >= {a.min_freq}\n",
       "\n## By tier\n"]+[f"- {k}: {v}" for k,v in by("tier")]
    L+=["\n## By category\n"]+[f"- {k}: {v}" for k,v in by("category")]
    L+=["\n## By intent\n"]+[f"- {k}: {v}" for k,v in by("intent")]
    L+=["\n## Core / safety\n", f"- core cards: {sum(r['core'] for r in order)}", f"- safety-flagged cards: {sum(r['safety'] for r in order)}",
        f"- multiword cards: {sum(1 for r in order if ' ' in r['label'])} (composable from single cards: {sum(r['composable'] for r in order)}, lexicalised/pragmatic: {sum(1 for r in order if ' ' in r['label'] and not r['composable'])})",
        f"- CBC cards retained: {sum(1 for r in order if 'cbc' in r['sources'])} of {len(cbc)}",
        f"- unmatched frequent corpus words written: {len(unm)} (see unmatched.txt)",
        f"- inflected forms folded into lemmas: {len(folded)}",
        f"- core threshold: >= {core_thr} of {nlists} lists, or Project Core, or curated core",
        f"- AAC corpus token coverage (aactext + turk dialogues, {tot} tokens): {coverage:.1%}"]
    open(os.path.join(a.out,"report.md"),"w").write("\n".join(L)+"\n")
    print("\n".join(L))

if __name__=="__main__":
    main()
