FROM node:20-alpine
WORKDIR /app
COPY backend/node-api/package.json ./
RUN npm install --omit=dev
COPY backend/node-api/src ./src
COPY frontend ./public
COPY proto ./proto
CMD ["node", "src/server.js"]
