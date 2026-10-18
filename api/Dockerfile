FROM node:20-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/src ./src
COPY api/public ./public
COPY proto ./proto
CMD ["node", "src/server.js"]
