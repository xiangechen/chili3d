FROM node:alpine
WORKDIR /chili3d
COPY . .
RUN npm install
EXPOSE 8080
CMD ["npm","run","dev"]
