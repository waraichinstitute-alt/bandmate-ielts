FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# Hugging Face Spaces route traffic to port 7860
ENV PORT=7860
EXPOSE 7860
CMD ["npm", "start"]
