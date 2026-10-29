# Voices storyboard lines with edge-tts and keeps the word timings (for subtitles).
#   python3 renderer/tts.py jobs.json
# jobs.json: [{"text": "...", "voice": "ru-RU-SvetlanaNeural", "rate": "+0%", "out": "path/without/extension"}, ...]
# Writes <out>.mp3 and <out>.json ({"words": [[start, end, word], ...]}) for each job; retries flaky connections.
import asyncio, json, sys
import edge_tts


async def one(job):
    last = None
    for attempt in range(6):
        audio, words = b'', []
        try:
            com = edge_tts.Communicate(job['text'], job['voice'], rate=job.get('rate', '+0%'), boundary='WordBoundary')
            async for m in com.stream():
                if m['type'] == 'audio':
                    audio += m['data']
                elif m['type'] == 'WordBoundary':
                    words.append([m['offset'] / 1e7, (m['offset'] + m['duration']) / 1e7, m['text']])
            if audio:
                with open(job['out'] + '.mp3', 'wb') as f:
                    f.write(audio)
                with open(job['out'] + '.json', 'w') as f:
                    json.dump({'words': words}, f, ensure_ascii=False)
                return
        except Exception as e:  # noqa: BLE001 - edge-tts raises many kinds of network errors
            last = e
        await asyncio.sleep(1.5 * (attempt + 1))
    raise SystemExit(f'edge-tts failed for "{job["text"][:40]}": {last}')


async def main():
    jobs = json.load(open(sys.argv[1]))
    sem = asyncio.Semaphore(3)

    async def guarded(j):
        async with sem:
            await one(j)
    await asyncio.gather(*(guarded(j) for j in jobs))

asyncio.run(main())
