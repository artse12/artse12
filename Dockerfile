FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY data/ ./data/

# profit-state.json y strategy-state.json se montan como volúmenes desde fuera
# El bot los crea automáticamente si no existen

CMD ["node", "dist/index.js"]
