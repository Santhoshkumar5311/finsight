FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@finsight/api --workspace=@finsight/core
COPY services/api/python services/api/python
RUN python3 -m venv /opt/parser && /opt/parser/bin/pip install --no-cache-dir -r services/api/python/requirements.txt
COPY database database
COPY services/api/src services/api/src
COPY packages/core/src packages/core/src
ENV NODE_ENV=production APP_MODE=live PORT=4000 STATEMENT_PYTHON=/opt/parser/bin/python
USER node
EXPOSE 4000
CMD ["node", "services/api/src/index.js"]
