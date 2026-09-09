#!/bin/sh
set -eu

local_docker_config="$(mktemp -d)"
trap 'rm -rf "$local_docker_config"' EXIT
printf '%s\n' '{"auths":{}}' > "$local_docker_config/config.json"

DOCKER_CONFIG="$local_docker_config" supabase start \
  --exclude studio,imgproxy,logflare,vector,supavisor,edge-runtime,postgres-meta \
  >/dev/null
printf '%s\n' 'Supabase Local started. Use `supabase status` when local credentials are needed.'
