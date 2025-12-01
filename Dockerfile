# Use an official Node.js image
FROM node:22

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy code
COPY . .

# Expose port
EXPOSE 8080

# Start command
CMD ["npm", "start"]
