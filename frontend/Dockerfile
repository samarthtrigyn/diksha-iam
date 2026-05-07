FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

# Source is mounted at runtime via docker-compose volume
EXPOSE 5173

CMD ["npm", "run", "dev"]
