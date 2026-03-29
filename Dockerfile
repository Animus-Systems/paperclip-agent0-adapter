FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm ci

COPY tsconfig.json jest.config.js ./
COPY src ./src

RUN npm run build

EXPOSE 4000

CMD ["node", "dist/src/server.js"]
