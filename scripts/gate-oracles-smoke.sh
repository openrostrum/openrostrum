#!/bin/bash
set -e
echo "=== #4 email outbox sink (insert + read back, local):"
npx wrangler d1 execute openrostrum --local --command "insert into email_outbox (id, \"to\", subject, html, status, created_at) values ('em_smoke','probe@example.com','smoke','<p>body</p>','sent',unixepoch())" >/dev/null 2>&1
npx wrangler d1 execute openrostrum --local --command "select id, \"to\", subject, status from email_outbox where id='em_smoke'" --json 2>/dev/null | python3 -c "import json,sys; print('read back:', json.load(sys.stdin)[0]['results'])"
npx wrangler d1 execute openrostrum --local --command "delete from email_outbox where id='em_smoke'" >/dev/null 2>&1

echo "=== #5 .ics parse oracle:"
cat > ics-fixture.ics <<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenRostrum//EN
BEGIN:VEVENT
UID:sess-1@openrostrum.com
DTSTART:20261012T170000Z
DTEND:20261012T174500Z
SUMMARY:Opening Keynote
LOCATION:Main Stage
END:VEVENT
END:VCALENDAR
ICS
python3 - <<'EOF'
fields = {}
for line in open('ics-fixture.ics'):
    if ':' in line:
        k, v = line.strip().split(':', 1)
        fields[k] = v
assert fields['SUMMARY'] == 'Opening Keynote' and fields['DTSTART'].endswith('Z'), fields
print('parsed VEVENT ok:', {k: fields[k] for k in ('SUMMARY','DTSTART','LOCATION')})
EOF
rm ics-fixture.ics

echo "=== #6 R2 roundtrip (remote bucket, same bytes back):"
head -c 1024 /dev/urandom > r2-probe.bin
npx wrangler r2 object put openrostrum-files/smoke/probe.bin --file r2-probe.bin --remote >/dev/null 2>&1
npx wrangler r2 object get openrostrum-files/smoke/probe.bin --file r2-probe-back.bin --remote >/dev/null 2>&1
cmp r2-probe.bin r2-probe-back.bin && echo "bytes identical"
npx wrangler r2 object delete openrostrum-files/smoke/probe.bin --remote >/dev/null 2>&1
rm -f r2-probe.bin r2-probe-back.bin
