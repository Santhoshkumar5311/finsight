FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@finsight/api --workspace=@finsight/core
COPY services/api/src services/api/src
COPY packages/core/src packages/core/src
ENV NODE_ENV=production APP_MODE=live PORT=4000
USER node
EXPOSE 4000
CMD ["node", "services/api/src/index.js"]
