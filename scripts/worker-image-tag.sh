#!/usr/bin/env sh
# 워커 이미지 태그: services/worker 폴더와 pnpm 잠금 파일의 git 해시로 만든다.
# 내용이 같으면 태그도 같아서, 워커를 바꾸지 않은 PR은 plan이 "No changes"이고 이미지를 다시 만들지 않는다.
set -eu
tree=$(git rev-parse HEAD:services/worker)
lock=$(git rev-parse HEAD:pnpm-lock.yaml)
printf '%s %s' "$tree" "$lock" | sha256sum | cut -c1-16
