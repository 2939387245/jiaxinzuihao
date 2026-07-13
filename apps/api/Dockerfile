FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /app/data /app/uploads
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data UPLOAD_DIR=/app/uploads
EXPOSE 8787
CMD ["node", "src/server.js"]
