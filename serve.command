#!/bin/bash
# Double-click (macOS) or run in a terminal: starts a local web server for the AYGIS 3D preview and opens it.
cd "$(dirname "$0")"
PORT=8765
echo "AYGIS 3D preview -> http://localhost:$PORT  (Ctrl+C to stop)"
( sleep 1; open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null ) &
python3 -m http.server $PORT
