#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres and runs the tests.
# Needs Postgres 15+ binaries (initdb, pg_ctl, psql) on PATH or in PG_BIN.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../migrations"
bin="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -n 1)")}"
data="$(mktemp -d)"
port="${PG_TEST_PORT:-54329}"
run_as=()
# Postgres refuses to run as root.
if [ "$(id -u)" = 0 ]; then chown -R postgres "$data"; run_as=(runuser -u postgres --); fi

cleanup() { "${run_as[@]}" "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT

"${run_as[@]}" "$bin/initdb" -D "$data" -U postgres --auth=trust >/dev/null
"${run_as[@]}" "$bin/pg_ctl" -D "$data" -o "-p $port -k $data -c listen_addresses=''" -w start >/dev/null

psql_run() { PGOPTIONS="-c client_min_messages=warning" "${run_as[@]}" "$bin/psql" -h "$data" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_run -f "$here/supabase-stub.sql"
for file in "$migrations"/*.sql; do
  echo "migrate $(basename "$file")"
  psql_run -f "$file"
  # An account that exists before 0002, like the ones on the live project.
  case "$(basename "$file")" in 0001_*)
    psql_run -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e0', 'early@example.com')"
    # Like the live project's first accounts: made before 0001, so no profile.
    psql_run -c "delete from public.profiles where id = '00000000-0000-0000-0000-0000000000e0'" ;;
  esac
done
# Pasting a migration into the SQL editor twice must be harmless (0001 predates this rule).
for file in "$migrations"/*.sql; do
  case "$(basename "$file")" in 0001_*) continue ;; esac
  psql_run -f "$file" >/dev/null
done
psql_run -f "$here/core.test.sql"
