FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built code
COPY dist/ ./dist/

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001
USER mcp

# Environment
ENV NODE_ENV=production
ENV MS365_MCP_PORT=3000
ENV MS365_MCP_HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
