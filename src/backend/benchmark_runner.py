import asyncio
from app.db.database import init_db, AsyncSessionLocal
from app.db.seed import seed_database
from app.engines.simulation import sim_engine
from app.engines.benchmark import run_benchmark

async def main():
    await init_db()
    async with AsyncSessionLocal() as s:
        await seed_database(s)
        await sim_engine.load_from_db(s)
    for _ in range(10):
        from app.db.database import AsyncSessionLocal as SS
        async with SS() as s:
            e = await sim_engine.process_next_event(s)
            if not e: break
    async with AsyncSessionLocal() as s:
        r = await run_benchmark(s)
        import json; print(json.dumps(r, indent=2, default=str))

asyncio.run(main())
