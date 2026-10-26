FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4310
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .
RUN mkdir -p /app/data

EXPOSE 4310
VOLUME ["/app/data"]
CMD ["node", "server.js"]
