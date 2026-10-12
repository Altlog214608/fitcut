# 채팅 수집기 이미지: Node.js 24 slim + esbuild로 묶은 코드 하나 (ADR-040)
# 빌드: pnpm --filter @fitcut/collector build 후 services/collector 에서
#   docker build --platform linux/arm64 -t fitcut-collector .
FROM public.ecr.aws/docker/library/node:24-slim
WORKDIR /app
COPY dist/index.mjs dist/index.mjs.map ./
ENV NODE_OPTIONS=--enable-source-maps
USER node
CMD ["node", "index.mjs"]
