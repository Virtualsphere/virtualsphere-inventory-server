# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
# Company logo for the warranty-card PDFs.
COPY logo.png ./logo.png
EXPOSE 4000
# Run migrations then start. (For stricter control, run `npm run migrate` as a
# separate release step and drop the migrate call here.)
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
