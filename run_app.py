import subprocess
import time
import sys
import os

print("=" * 60)
print("  Redrob AI Candidate Discovery & Ranking Dashboard  ")
print("=" * 60)

# Start FastAPI backend
print("\n[1/2] Launching FastAPI Backend on http://localhost:8000...")
backend_cmd = [sys.executable, "backend/backend.py"]
backend_process = subprocess.Popen(
    backend_cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

# Wait for backend to load dataset and model (usually 3-4 seconds)
time.sleep(4)

# Start Next.js frontend
print("[2/2] Launching Next.js Frontend Dashboard on http://localhost:3000...")
frontend_process = subprocess.Popen(
    ["npm.cmd", "run", "dev"],
    cwd="frontend",
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    shell=True,
    bufsize=1
)

print("\n" + "=" * 60)
print("  SUCCESS: Both servers are running in the background!")
print("  --> Dashboard: http://localhost:3000")
print("  --> API Docs:  http://localhost:8000/docs")
print("  Press Ctrl+C to terminate both servers.")
print("=" * 60 + "\n")

try:
    while True:
        # Check if either process has ended
        if backend_process.poll() is not None:
            print("\n[ERROR] Backend process terminated unexpectedly.")
            stdout, _ = backend_process.communicate()
            print("Backend output:")
            print(stdout)
            break
            
        if frontend_process.poll() is not None:
            print("\n[ERROR] Frontend process terminated unexpectedly.")
            stdout, _ = frontend_process.communicate()
            print("Frontend output:")
            print(stdout)
            break
            
        time.sleep(1)
except KeyboardInterrupt:
    print("\nShutting down servers...")
    backend_process.terminate()
    frontend_process.terminate()
    print("Both servers terminated. Goodbye!")
