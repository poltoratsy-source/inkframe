# Inkframe in a container: the studio on port 3700 (demo engine by default, see .env.example).
FROM node:20-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=3700
EXPOSE 3700
CMD ["npm", "start"]
