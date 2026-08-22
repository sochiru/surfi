#!/bin/sh
set -e

# Hosts that attach the data volume as a root-owned bind mount (Railway, Fly,
# plain `-v /host/path:/data`) shadow the image's build-time chown, leaving the
# unprivileged runtime user unable to create the SQLite file. Take ownership
# while still root, then drop privileges for the server itself.
if [ "$(id -u)" = "0" ]; then
  data_dir=$(dirname "${WF_DB_PATH:-/data/wealthfolio.db}")
  mkdir -p "$data_dir"
  chown -R 1000:1000 "$data_dir"
  exec su-exec 1000:1000 "$@"
fi

exec "$@"
