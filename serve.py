#!/usr/bin/env python3
"""
Simple local development HTTP server for the APNIC Transfers Analytics web dashboard.
"""

import argparse
import http.server
import os
import socketserver
import sys
import webbrowser
from pathlib import Path


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow Cross-Origin access and ensure proper MIME types for WASM
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)


def run_server(port: int = 8000, host: str = "127.0.0.1", open_browser: bool = True):
    directory = Path(__file__).parent.resolve()
    os.chdir(directory)

    handler = CustomHandler
    
    # Try finding an open port if port is busy
    attempts = 10
    current_port = port
    server = None

    for i in range(attempts):
        try:
            server = socketserver.TCPServer((host, current_port), handler)
            break
        except OSError:
            current_port += 1

    if server is None:
        print(f"Error: Could not bind server to ports {port} - {port + attempts - 1}", file=sys.stderr)
        sys.exit(1)

    url = f"http://{host}:{current_port}/"
    print("=" * 70)
    print("🚀 APNIC Resource Transfers Analytics Dashboard (sql.js + Chart.js)")
    print("=" * 70)
    print(f"  Local Web Server:  {url}")
    print(f"  Root Directory:    {directory}")
    print("  Press Ctrl+C to stop the server.")
    print("=" * 70)

    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run APNIC Transfers Web Dashboard server.")
    parser.add_argument("-p", "--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to listen on (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")

    args = parser.parse_args()
    run_server(port=args.port, host=args.host, open_browser=not args.no_browser)
