FROM node:22-alpine

# Chromium für Puppeteer (Stellenanzeigen scrapen)
# + Schriftarten, damit Pages mit nicht-lateinischen Glyphen korrekt rendern
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
  && rm -rf /var/cache/apk/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
