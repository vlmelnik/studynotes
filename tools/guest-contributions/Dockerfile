FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/dependencies
COPY package.json package-lock.json ./
ENV ONNXRUNTIME_NODE_INSTALL=skip ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY validate.sh /opt/validate.sh
ENV HOME=/tmp CI=true
ENTRYPOINT ["/bin/sh", "/opt/validate.sh"]
