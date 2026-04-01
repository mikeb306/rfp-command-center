FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4310

CMD ["node", "--env-file-if-exists=.env", "src/server.js"]
