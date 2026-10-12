#!/bin/bash
# Healthy once the bot's Spring API answers (no curl/wget in the image; use bash's /dev/tcp).
exec 3<>/dev/tcp/127.0.0.1/8081 2>/dev/null || exit 1
printf 'GET /api/public/ping HTTP/1.0\r\nHost: localhost\r\n\r\n' >&3
read -r -t 5 status <&3 || exit 1
case "$status" in *" 200"*) exit 0 ;; *) exit 1 ;; esac
