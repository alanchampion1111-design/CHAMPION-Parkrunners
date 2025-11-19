# Use an official Node.js image
FROM node:14

# Set the working directory
WORKDIR /app

# Copy package*.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the code
COPY . .

# Expose the port
EXPOSE 8080

# Command to run
CMD ["node", "index.js"]
