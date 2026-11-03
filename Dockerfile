# One image with the API and the web app. The server serves the built web app from WEB_DIR.
FROM node:24-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM manifests AS web
RUN npm ci -w apps/web
COPY apps/web/ apps/web/
RUN npm run tokens -w apps/web && npm run build -w apps/web

FROM manifests AS server
RUN npm ci -w apps/server
COPY apps/server/ apps/server/
RUN npm run build -w apps/server

FROM manifests AS server-deps
RUN npm ci -w apps/server --omit=dev && mkdir -p apps/server/node_modules

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIR=/app/web
WORKDIR /app/apps/server
COPY --from=server-deps /app/node_modules /app/node_modules
# Anything npm had to nest under the server instead of hoisting (usually empty).
COPY --from=server-deps /app/apps/server/node_modules ./node_modules
COPY --from=server /app/apps/server/dist ./dist
COPY --from=server /app/apps/server/package.json ./
COPY --from=web /app/apps/web/dist/web/browser /app/web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
