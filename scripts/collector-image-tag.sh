#!/usr/bin/env sh
# 수집기 이미지 태그: services/collector, packages/chzzk, pnpm 잠금 파일의 git 해시로 만든다.
# 내용이 같으면 태그도 같아서, 수집기를 바꾸지 않은 PR은 plan이 바뀌지 않고 이미지를 다시 만들지 않는다.
set -eu
collector=$(git rev-parse HEAD:services/collector)
chzzk=$(git rev-parse HEAD:packages/chzzk)
lock=$(git rev-parse HEAD:pnpm-lock.yaml)
printf '%s %s %s' "$collector" "$chzzk" "$lock" | sha256sum | cut -c1-16
