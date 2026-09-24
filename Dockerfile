FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts index.html metadata.json .env.example ./
COPY src ./src
COPY server.ts ./server.ts
COPY api ./api
COPY worker ./worker
RUN npm install --ignore-scripts
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
