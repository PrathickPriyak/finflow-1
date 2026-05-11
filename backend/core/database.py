"""
Database connection and scheduler setup
"""
from motor.motor_asyncio import AsyncIOMotorClient
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent.parent
# Load .env only for local development; in Docker, env vars come from docker-compose
if not os.environ.get('DOCKER_ENV'):
    load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Scheduler for background jobs
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
