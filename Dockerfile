FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# Back4App Containers routes external traffic to port 80
ENV PORT=80
EXPOSE 80
CMD ["npm", "start"]
