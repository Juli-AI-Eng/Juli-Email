# ---------- Build stage ----------
FROM node:20-alpine AS build

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src ./src

# Build the TypeScript code
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache tini

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from build stage
COPY --from=build /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the default port
EXPOSE 3001

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the server
CMD ["node", "dist/server.js"]
