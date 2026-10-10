# 워커 이미지: Lambda Node.js 24 기본 이미지 + ffmpeg·ffprobe 정적 빌드 (ADR-032)
# 빌드: pnpm --filter @fitcut/worker build 후 services/worker 에서
#   docker build --platform linux/arm64 -t fitcut-worker .
# ffmpeg는 BtbN/FFmpeg-Builds의 월말 빌드(2년 보관)를 버전·체크섬으로 고정한다.
# GPL 빌드(libx264 포함)라서 이미지는 비공개 ECR에만 두고 배포하지 않는다.

FROM public.ecr.aws/docker/library/alpine:3.22 AS ffmpeg
ARG TARGETARCH
ARG FFMPEG_RELEASE=autobuild-2026-09-30-13-08
ARG FFMPEG_VERSION=n9.0.2-17-g2a571b6068
ARG SHA256_ARM64=91afcd7695d4bbbb9e0057aa10baaf9875ec4e1a97303f9059ec971336a2ab46
ARG SHA256_AMD64=68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269
RUN apk add --no-cache curl xz
RUN set -eu; \
    if [ "$TARGETARCH" = "arm64" ]; then arch=linuxarm64; sum=$SHA256_ARM64; else arch=linux64; sum=$SHA256_AMD64; fi; \
    name="ffmpeg-${FFMPEG_VERSION}-${arch}-gpl-9.0"; \
    curl -fsSL -o ffmpeg.tar.xz "https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/${name}.tar.xz"; \
    echo "${sum}  ffmpeg.tar.xz" | sha256sum -c -; \
    tar -xJf ffmpeg.tar.xz; \
    mkdir /out; \
    cp "${name}/bin/ffmpeg" "${name}/bin/ffprobe" /out/; \
    cp "${name}/LICENSE.txt" /out/FFMPEG-LICENSE.txt

FROM public.ecr.aws/lambda/nodejs:24
COPY --from=ffmpeg /out/ffmpeg /out/ffprobe /opt/bin/
COPY --from=ffmpeg /out/FFMPEG-LICENSE.txt /opt/
COPY dist/index.mjs dist/index.mjs.map ${LAMBDA_TASK_ROOT}/
ENV FFMPEG_PATH=/opt/bin/ffmpeg \
    FFPROBE_PATH=/opt/bin/ffprobe \
    NODE_OPTIONS=--enable-source-maps
CMD ["index.handler"]
