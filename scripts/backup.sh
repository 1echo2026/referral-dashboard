#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date +%F-%H%M)"
tar -czf "backups/dashboard-${stamp}.tar.gz" data/dashboard.db data/base-accounts.csv
find backups -type f -name 'dashboard-*.tar.gz' -mtime +14 -delete
echo "backup created: backups/dashboard-${stamp}.tar.gz"
