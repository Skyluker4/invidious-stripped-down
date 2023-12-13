# Use Alpine Linux as the base image
FROM alpine:3.19.0

# Set the working directory
WORKDIR /opt/invidious-stripped-down

# Copy index.js to the working directory
COPY index.js .

# Install Node.js and npm
RUN apk add --no-cache nodejs npm

# Install npm dependencies
COPY package.json .
COPY package-lock.json .
RUN npm install

# Run index.js with Node.js
CMD ["node", "index.js"]
