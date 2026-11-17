FROM node:22-alpine

# Chromium für Puppeteer (Stellenanzeigen scrapen)
# + Schriftarten, damit Pages mit nicht-lateinischen Glyphen korrekt rendern
# + python3/py3-pillow/fontconfig für den Reel-Render (R2: subs.py/endcard.py, Kinetik-Typografie)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ffmpeg \
    python3 \
    py3-pillow \
    fontconfig \
  && rm -rf /var/cache/apk/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Reel-Fonts (Montserrat ExtraBold + Permanent Marker) systemweit registrieren,
# damit libass (ffmpeg) und PIL sie in R2 über den Familiennamen finden.
RUN mkdir -p /usr/share/fonts/truetype/reel \
  && cp assets/fonts/Montserrat-ExtraBold.ttf assets/fonts/PermanentMarker-Regular.ttf /usr/share/fonts/truetype/reel/ \
  && fc-cache -f \
  && rm -rf /var/cache/apk/*
# Hinweis: faster-whisper ist auf Alpine/musl (ctranslate2 ohne musl-Wheels) nicht praktikabel;
# der Whisper-Fallback läuft in R2 über die gehostete OpenAI-API (whisper-1), kein lokaler Build nötig.

EXPOSE 3001

CMD ["node", "server.js"]
