FROM node:18-bullseye-slim

WORKDIR /app

# install dependencies (including dev deps for build/migrations)
COPY package.json package-lock.json* ./
RUN npm ci --silent || npm install --silent

# copy source
COPY . .

# generate prisma client and build
RUN npx prisma generate --silent || true
RUN npm run build --silent || true

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "/app/docker-entrypoint.sh"]
