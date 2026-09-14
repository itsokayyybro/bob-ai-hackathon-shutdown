import asyncio
from app.db.database import init_db, AsyncSessionLocal
from app.db.seed import seed_database
from app.engines.simulation import sim_engine

async def main():
    await init_db()
    async with AsyncSessionLocal() as s:
        await seed_database(s)
        await sim_engine.load_from_db(s)
    print("Database seeded successfully")

asyncio.run(main())
