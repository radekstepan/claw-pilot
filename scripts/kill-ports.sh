#!/bin/bash

set -a
source "$(dirname "$0")/../.env"
set +a

lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
lsof -ti:$VITE_PORT | xargs kill -9 2>/dev/null || true