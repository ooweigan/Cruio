#!/usr/bin/env bash
set -euo pipefail

adminAccount=""
case "${1:-}" in
  "") ;;
  --admin)
    if [[ $# -ne 2 || -z "$2" ]]; then
      printf '用法：bash startAccount.sh --admin 已有账号\n' >&2
      exit 1
    fi
    adminAccount="$2"
    ;;
  --help|-h)
    printf '启动后管：bash startAccount.sh\n设置已有账号为管理员并启动：bash startAccount.sh --admin demo\n'
    exit 0
    ;;
  *) printf '未知参数。使用 bash startAccount.sh --help 查看用法。\n' >&2; exit 1 ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  printf '未找到 bun，请先安装 Bun 并确保其在 PATH 中。\n' >&2
  exit 1
fi

scriptDirectory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$scriptDirectory/apps/admin"
export CRUIO_IDENTITY_DATA_DIR="${CRUIO_IDENTITY_DATA_DIR:-$HOME/.cruio/accountService}"

if [[ -n "$adminAccount" ]]; then
  bun src/manage.ts makeAdmin "$adminAccount"
fi

exec bun src/index.ts
