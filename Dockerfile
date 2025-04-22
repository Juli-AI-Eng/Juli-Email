# ---------- Build stage ----------
FROM node:20-alpine AS build

WORKDIR /app

# 1. install deps first for better cache hits
COPY package*.json ./
RUN npm ci

# 2. copy sources & compile TypeScript → dist/
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine

WORKDIR /app

# Only bring the compiled JS and production deps
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Smithery injects the final CMD, but keeping a default helps local `docker run`
CMD ["node", "dist/index.js"]
