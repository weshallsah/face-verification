#!/bin/bash
# Creates the least-privilege role used by the api and face-service.
# Runs after 001_init.sql (initdb scripts run in name order), so the tables exist.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -v pw="$FACE_DB_PASSWORD" --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-app}" <<'SQL'
SELECT format('CREATE ROLE face_svc LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'face_svc') \gexec
SELECT format('ALTER ROLE face_svc PASSWORD %L', :'pw') \gexec
GRANT CONNECT ON DATABASE app TO face_svc;
GRANT USAGE ON SCHEMA public TO face_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO face_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO face_svc;
SQL
