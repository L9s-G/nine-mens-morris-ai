#!/bin/bash
# 在 3000 端口启动静态 HTTP 服务，根目录指向项目根目录（test/ 的父目录）
cd "$(dirname "$0")/.."
npx --yes http-server -p 3000 -c-1 --cors
