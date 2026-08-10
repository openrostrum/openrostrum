#!/bin/bash
# Row 1 smoke: each seeded role logs in over HTTP and reaches its shell.
for u in admin@example.com reviewer@example.com speaker@example.com; do
  jar=$(mktemp)
  code=$(curl -s -o /dev/null -w "%{http_code}" -c "$jar" -d "email=$u&password=password" https://openrostrum.com/login)
  landed=$(curl -s -o /dev/null -w "%{url_effective} %{http_code}" -b "$jar" -L https://openrostrum.com/admin)
  echo "$u  login:$code  /admin→ $landed"
  rm -f "$jar"
done
