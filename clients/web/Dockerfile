# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache openssl curl
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.deploy.sh /docker-entrypoint.deploy.sh
RUN chmod +x /docker-entrypoint.deploy.sh
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint.deploy.sh"]
