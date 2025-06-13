FROM node:24-alpine
WORKDIR /app
COPY ./ /app/
RUN npm install
EXPOSE 8080
RUN npm run build
CMD ["npm","run","dev"]