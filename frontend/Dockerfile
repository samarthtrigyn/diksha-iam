FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy peer deps support and force flag
# This helps resolve conflicts that can occur in Docker
RUN npm install --legacy-peer-deps --force || npm install --legacy-peer-deps --force --verbose

# Source is mounted at runtime via docker-compose volume
EXPOSE 5173

# Start Vite dev server
CMD ["npm", "run", "dev"]
