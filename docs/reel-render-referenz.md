# Reel-Render-Skripte (Referenzimplementierung aus der Wilhelm-Produktion, 17.11.2026)

Diese drei Skripte haben im Higgsfield-Sandbox das B-Roll-Reel geschnitten. Sie sind die Vorlage für den Render-Dienst des Reel-Moduls (siehe `reel-modul-spec.md`). Eingaben: `words.json` (Whisper-Worttimings `[start, end, wort]`), Clips `c1.mp4 … c9.mp4` (720p 9:16), `vo.mp3` (Stimme), `music.mp3`, `logo.png` (transparent), Fonts Montserrat ExtraBold und Permanent Marker.

## Ablauf

1. Whisper (faster-whisper `small`, `word_timestamps=True`, Sprache de) → `words.json`
2. `subs.py` → `kin.ass` (Kinetik-Typografie; Blöcke mit `|` als Zeilenumbruch, `*Wort*` = Schlüsselwort in Marker-Schrift; Fix-Liste für Firmennamen)
3. `endcard.py` → `endcard.png` (1080×1920, Firmenfarbe, Logo auf weißem Panel, Titel, Region, Button)
4. `render2.sh` → Clips trimmen (Satzlängen in `D`), Concat, ASS drüber, Endkarte 6,5 s mit Fade-in, Audio-Mix (Stimme +3,5 dB, Musik −17,5 dB, Fades), faststart, Decoder-Check

## subs.py

```python
import json,re
words=json.load(open('words.json'))
# normalize tokens: merge "Bau" + "-Dekoration."
toks=[]
i=0
while i<len(words):
    st,en,w=words[i]; w=w.strip()
    if w=='Bau' and i+1<len(words) and words[i+1][2].strip().startswith('-'):
        toks.append([st,words[i+1][1],'Baudekoration.']); i+=2; continue
    toks.append([st,en,w]); i+=1
fix={'Tappezieren,':'Tapezieren,','Strauß,':'Strauss,'}
for t in toks: t[2]=fix.get(t[2],t[2])
blocks="""HALB SIEBEN|IN USINGEN.
DER BUS STEHT|VOR DEINER TÜR.
FIRMENWAGEN.|AUCH *PRIVAT.*
WIR SIND|WILHELM BAUDEKORATION.
MALERBETRIEB|SEIT *1885.*
VERPUTZEN, TAPEZIEREN,|LACKIEREN, KREATIVTECHNIK.
JEDE WOCHE|EINE ANDERE BAUSTELLE,
KEINE WEITER ALS|*50 KILOMETER.*
KLAMOTTEN VON STRAUSS,|WERKZEUG UND MASCHINEN|GESTELLT.
DU BRINGST|NUR *DICH* MIT.
AUFMASS AUFS TABLET,|PLAN AUFS HANDY.
ZETTELWIRTSCHAFT|GIBT'S HIER *NICHT.*
DU HAST 'NE|BESSERE IDEE,|WIE'S GEHT?
DANN MACHEN|WIR'S *SO.*
WER MEHR WILL,|KRIEGT SCHULUNGEN.
UND IRGENDWANN|DIE EIGENE *KOLONNE.*
BEZAHLT WIRD|NACH TARIF.
UND ZWAR|*PÜNKTLICH.*
WIR SUCHEN|MALER UND LACKIERER,
DIE BOCK AUF|EIN TEAM HABEN,|DAS *ZUSAMMENHÄLT.*
*LINK*|IN DER ANZEIGE.
EINE MINUTE,|*FERTIG.*""".split('\n')
def norm(s): return re.sub(r"[^a-z0-9äöüß]","",s.lower().replace('ß','ss'))
ti=0
allblocks=[]
for b in blocks:
    lines=[]
    for ln in b.split('|'):
        ws=[]
        for w in ln.split(' '):
            emph=w.startswith('*') or w.endswith('*'); w=w.strip('*')
            st,en,tw=toks[ti]
            a,c=norm(w),norm(tw)
            if a!=c and not (a=="ne" and c=="eine") and not (a=="aufmass" and c in("aufmass","aufmas")):
                raise SystemExit(f"mismatch {w!r} vs {tw!r} at {ti}")
            ws.append((st,en,w,emph)); ti+=1
        lines.append(ws)
    allblocks.append(lines)
assert ti==len(toks),(ti,len(toks))
def fmt(t):
    h=int(t//3600);m=int(t%3600//60);s=t%60
    return f"{h}:{m:02d}:{s:05.2f}"
def render(lines,upto):
    out=[]
    k=0
    for ln in lines:
        parts=[]
        for st,en,w,emph in ln:
            if k>upto: break
            tag=r"{\fnPermanent Marker\fs116\bord5}" if emph else r"{\fnMontserrat ExtraBold\fs94\bord4}"
            if k==upto:
                tag=tag[:-1]+r"\fscx70\fscy70\t(0,110,\fscx100\fscy100)}"
            parts.append(tag+w)
            k+=1
        if parts: out.append(' '.join(parts))
        if k>upto: break
    return r"\N".join(out)
hdr="""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: K,Montserrat ExtraBold,84,&H00FFFFFF,&H00FFFFFF,&H00141414,&H90000000,-1,0,0,0,100,100,0,0,1,4,3,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
ev=[]
for bi,lines in enumerate(allblocks):
    flat=[w for ln in lines for w in ln]
    nxt=allblocks[bi+1][0][0][0] if bi+1<len(allblocks) else flat[-1][1]+0.6
    block_end=min(nxt, flat[-1][1]+0.9)
    for k,(st,en,w,emph) in enumerate(flat):
        e= flat[k+1][0] if k+1<len(flat) else block_end
        if e<=st: e=st+0.05
        ev.append(f"Dialogue: 0,{fmt(st)},{fmt(e)},K,,0,0,0,,{{\\an5\\pos(540,1230)}}{render(lines,k)}")
open('kin.ass','w').write(hdr+'\n'.join(ev)+'\n')
print(len(ev),'events, last end',fmt(block_end))
```

## endcard.py

```python
from PIL import Image, ImageDraw, ImageFont
W,H=1080,1920
BLUE=(0,48,136); WHITE=(255,255,255)   # Firmenfarbe
im=Image.new('RGB',(W,H),BLUE); d=ImageDraw.Draw(im)
F='/usr/share/fonts/truetype/higgsfield/Montserrat-ExtraBold.ttf'
def font(s): return ImageFont.truetype(F,s)
logo=Image.open('logo.png').convert('RGBA')
pw=900; lw=760; lh=int(logo.height*lw/logo.width)
logo=logo.resize((lw,lh),Image.LANCZOS)
ph=lh+120; px=(W-pw)//2; py=330
d.rounded_rectangle((px,py,px+pw,py+ph),radius=40,fill=WHITE)
im.paste(logo,((W-lw)//2,py+60),logo)
def center(text,y,size,fill=WHITE):
    f=font(size); w=d.textlength(text,font=f); d.text(((W-w)/2,y),text,font=f,fill=fill)
y=py+ph+120
center("MALER & LACKIERER",y,74); center("(M/W/D)",y+95,54)
center("Usingen · Baustellen im Umkreis von 50 km",y+200,38,fill=(200,214,236))
bw,bh=840,150; bx=(W-bw)//2; by=1480
d.rounded_rectangle((bx,by,bx+bw,by+bh),radius=75,fill=WHITE)
f=font(56); t="JETZT BEWERBEN"; w=d.textlength(t,font=f); d.text(((W-w)/2,by+(bh-70)/2),t,font=f,fill=BLUE)
center("Link in der Anzeige · dauert keine Minute",by+bh+40,36,fill=(200,214,236))
im.save('endcard.png')
```

## render2.sh

```bash
set -e
cd /home/user/wilhelm
D=(6.04 4.91 6.90 4.25 4.10 2.45 3.90 2.65 4.00)   # Satzlängen aus den Worttimings
F=""; IN=""
for i in 1 2 3 4 5 6 7 8 9; do
  if [ $i = 1 ]; then IN="$IN -i c1b.mp4"; else IN="$IN -i c$i.mp4"; fi
  # erster Clip wurde 2 s länger generiert, die ersten 0,3 s (Standbild) fallen weg
  if [ $i = 1 ]; then F="$F[0:v]trim=0.3:6.34"; else F="$F[$((i-1)):v]trim=0:${D[$((i-1))]}"; fi
  F="$F,setpts=PTS-STARTPTS,fps=24,scale=1080:1920:flags=lanczos,setsar=1[v$i];"
done
F="$F[9:v]trim=0:6.5,setpts=PTS-STARTPTS,fps=24,format=yuv420p,setsar=1,fade=t=in:st=0:d=0.4[v10];"
F="$F[v1][v2][v3][v4][v5][v6][v7][v8][v9][v10]concat=n=10:v=1:a=0[vc];[vc]ass=kin.ass[vo]"
ffmpeg -y -v error $IN -loop 1 -framerate 24 -i endcard.png -filter_complex "$F" -map "[vo]" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an video_silent2.mp4
# Audio: Stimme +3,5 dB, Musik −17,5 dB mit Fades, auf Videolänge gepolstert
ffmpeg -y -v error -i vo.mp3 -i music.mp3 -filter_complex \
 "[0:a]volume=3.5dB,aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=45.8[v];\
  [1:a]atrim=0:45.8,asetpts=PTS-STARTPTS,volume=-17.5dB,afade=t=in:st=0:d=1.0,afade=t=out:st=43.3:d=2.5,aformat=sample_rates=44100:channel_layouts=stereo[m];\
  [v][m]amix=inputs=2:normalize=0:duration=first[a]" -map "[a]" -c:a aac -b:a 192k audio2.m4a
ffmpeg -y -v error -i video_silent2.mp4 -i audio2.m4a -c:v copy -c:a copy -shortest -movflags +faststart wilhelm_final_v2.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 wilhelm_final_v2.mp4
ffmpeg -v error -i wilhelm_final_v2.mp4 -f null - 2>&1 | wc -l    # muss 0 sein
```

## Bildvorbereitung (2:3 → 9:16)

```python
from PIL import Image, ImageFilter
W,H=1080,1920
im=Image.open(src).convert('RGB')
if volle_breite:   # Gruppenbilder
    bg=im.resize((W,H)).filter(ImageFilter.GaussianBlur(40))
    fg=im.resize((W,int(W*im.height/im.width))); bg.paste(fg,(0,(H-fg.height)//2)); out=bg
else:
    cw=int(im.height*9/16); x=(im.width-cw)//2
    out=im.crop((x,0,x+cw,im.height)).resize((W,H),Image.LANCZOS)
out.save(dst,quality=95,subsampling=0)
```

## Erfahrungswerte

- Seedance 2.0 Mini (5 Credits / 5 s, 720p) hielt Gesichter und Logos in allen 9 Clips stabil; Kling 3.0 Turbo über MCP hing zweimal >10 min.
- Ersten Clip immer 2 s länger generieren und vorne 0,3–0,5 s abschneiden (Standbild-Anlauf).
- Clip-Dauer = Satzdauer + ~1 s, min. 4 s.
- Musik: ElevenLabs Music v2.5, instrumental, 50 s, ~7 Credits; Stimme −20,7 LUFS roh, Musik −14,3 LUFS roh → Mix −17 LUFS.
- Gesamt Wilhelm: ~65 Credits inkl. Testclips und Nachbesserung.
