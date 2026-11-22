FROM node:alpine AS builder
WORKDIR '/app'
COPY . .
RUN npm install && npm run build

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
