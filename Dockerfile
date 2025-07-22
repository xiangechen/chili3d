FROM node:alpine AS builder

WORKDIR '/app'

COPY . .

RUN --mount=type=cache,target=/root/.npm npm install && npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
