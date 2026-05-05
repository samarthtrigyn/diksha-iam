#!/bin/bash

# DIKSHA IAM Quick Start Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 DIKSHA IAM Quick Start"
echo "=========================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed. Please install Docker first."
  exit 1
fi

echo "✓ Docker found"

# Start services
echo ""
echo "Starting services..."
cd "$SCRIPT_DIR"
docker compose up -d

echo "✓ Services starting..."

# Wait for services to be ready
echo ""
echo "Waiting for services to be ready..."
RETRY=0
MAX_RETRIES=30

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:4000/health > /dev/null 2>&1; then
    break
  fi
  RETRY=$((RETRY + 1))
  sleep 1
done

if [ $RETRY -eq $MAX_RETRIES ]; then
  echo "⚠️  Services may still be starting. Check logs with: docker compose logs"
else
  echo "✓ All services ready"
fi

echo ""
echo "=== System Ready ==="
echo ""
echo "📱 Frontend: http://localhost:5173"
echo "🔐 Keycloak: http://localhost:8080"
echo "🎛️  Orchestrator: http://localhost:4000"
echo "📊 IAM Service: http://localhost:3000"
echo ""
echo "🧪 Run Tests:"
echo "   bash test-e2e.sh"
echo ""
echo "📖 Documentation:"
echo "   cat SETUP_GUIDE.md"
echo "   cat IMPLEMENTATION_SUMMARY.md"
echo ""
echo "✨ Happy testing!"
