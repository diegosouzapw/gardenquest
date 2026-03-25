import http.server
import socketserver
import datetime
import threading
import time
import os
import sys

PORT = 5500
DIRECTORY = "frontend/public"

# Global counter for requests
REQUEST_COUNT = 0
COUNTER_LOCK = threading.Lock()

class DiagnosticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        global REQUEST_COUNT
        with COUNTER_LOCK:
            REQUEST_COUNT += 1
        return super().do_GET()

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          datetime.datetime.now().strftime("%H:%M:%S"),
                          format%args))
        sys.stderr.flush()

def heartbeat_pulse():
    while True:
        with COUNTER_LOCK:
            current_count = REQUEST_COUNT
        print(f"[HOST-HEARTBEAT] 🚀 Port 5500 ALIVE | Time: {datetime.datetime.now().strftime('%H:%M:%S')} | Total Req: {current_count}", flush=True)
        time.sleep(1)

if __name__ == "__main__":
    # Path correction for different execution contexts
    target_dir = DIRECTORY
    if not os.path.exists(target_dir):
        if os.path.exists("index.html"):
            target_dir = "."
        elif os.path.exists("public/index.html"):
            target_dir = "public"
        else:
            print(f"ERRO: Diretorio de frontend nao encontrado! Executando na raiz do projeto?", flush=True)
            # Default to current anyway if we are desperate
            target_dir = "."

    # Start 1-second heartbeat
    threading.Thread(target=heartbeat_pulse, daemon=True).start()

    class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True

    with ThreadedTCPServer(("", PORT), DiagnosticHandler) as httpd:
        print(f"==========================================", flush=True)
        print(f"🚀 HOST DIAGNOSTICO ATIVADO (Porta {PORT})", flush=True)
        print(f"Servindo: {os.path.abspath(target_dir)}", flush=True)
        print(f"==========================================", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor parado.", flush=True)
